use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{StreamExt, TryStreamExt};
use serde::Serialize;
use tokio::sync::broadcast;

use bcs::to_bytes;
use ech_board_entity::{Entity, Output, Stored};
use ech_board_program::entity::{Board, BoardKey, Post, Thread, ThreadKey};
use ech_board_program::types::Hash;
use ech_db_protocol::value::{Author, UserPart};

use crate::content::Store;
use crate::error::DomainError;
use crate::forum::Forum as ForumApi;
use crate::geo::Geo;
use crate::resources::Resources;
use crate::tripcode::Trips;

pub struct App {
    pub forum: Arc<ForumApi>,
    pub hub: Arc<Hub>,
    pub content: Arc<Store>,
    pub geo: Arc<Geo>,
    pub trips: Arc<Trips>,
}

#[derive(Clone, Serialize)]
pub struct EntityPayload {
    pub kind: String,
    pub id: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
pub struct BlobPayload {
    pub hash: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
pub struct ReactionEvent {
    pub author: String,
    pub post: String,
    pub value: Option<String>,
}

impl ReactionEvent {
    fn from_user(user: &UserPart) -> Result<Option<Self>, DomainError> {
        if user.call.function != "post.react" {
            return Ok(None);
        }
        let Author::User { esid, .. } = &user.author else {
            return Ok(None);
        };
        let (post, previous, reaction): (Hash, Option<Hash>, Hash) =
            bcs::from_bytes(&user.call.args)?;
        Ok(Some(Self {
            author: hex::encode(to_bytes(esid)?),
            post: hex::encode(post),
            value: (previous != Some(reaction)).then(|| hex::encode(reaction)),
        }))
    }
}

#[derive(Clone, Serialize)]
pub struct Event {
    pub txid: String,
    pub function: String,
    pub reaction: Option<ReactionEvent>,
    pub board: String,
    pub thread: String,
    pub entities: Vec<EntityPayload>,
    pub contents: Vec<BlobPayload>,
    pub attachments: Vec<BlobPayload>,
    pub transactions: Vec<BlobPayload>,
}

pub struct Hub {
    sender: broadcast::Sender<Event>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }

    pub fn publish(&self, event: Event) {
        let _ = self.sender.send(event);
    }

    async fn resources(
        &self,
        store: &Store,
        forum: &ForumApi,
        entities: &[EntityPayload],
    ) -> Result<(Vec<BlobPayload>, Vec<BlobPayload>, Vec<BlobPayload>), DomainError> {
        let mut resources = Resources::default();
        let owners: Vec<_> = entities
            .iter()
            .map(|entity| (entity.kind.clone(), entity.id.clone()))
            .collect();
        let mut reads = futures_util::stream::iter(owners)
            .map(|(kind, id)| async move {
                let id = hex::decode(id)
                    .ok()
                    .and_then(|bytes| bytes.try_into().ok())
                    .ok_or_else(|| DomainError::BadRequest("invalid entity id".into()))?;
                Resources::entity(forum, &kind, id).await
            })
            .buffer_unordered(32);
        while let Some(next) = reads.try_next().await? {
            resources.extend(next);
        }
        let loaded = resources.load(store, forum).await?;
        let contents = loaded
            .contents
            .into_iter()
            .filter_map(|(hash, bytes)| {
                bytes.map(|bytes| BlobPayload {
                    hash: hex::encode(hash),
                    value: hex::encode(bytes),
                })
            })
            .collect();
        let attachments = loaded
            .attachments
            .into_iter()
            .filter_map(|(hash, meta)| {
                meta.map(|meta| {
                    Ok(BlobPayload {
                        hash: hex::encode(hash),
                        value: hex::encode(bcs::to_bytes(&meta)?),
                    })
                })
            })
            .collect::<Result<_, DomainError>>()?;
        let mut transactions = Vec::with_capacity(loaded.transactions.len());
        for (hash, tx) in loaded.transactions {
            transactions.push(BlobPayload {
                hash: hex::encode(hash),
                value: hex::encode(to_bytes(&tx)?),
            });
        }
        Ok((contents, attachments, transactions))
    }

    fn scope(&self, entities: &[EntityPayload]) -> Result<(String, String), DomainError> {
        if let Some(post) = changed_entity::<Post>(entities)? {
            let board = Board::id(&BoardKey {
                slug: post.value.key.board.clone(),
            });
            let thread = Thread::id(&ThreadKey {
                number: post.value.thread,
                board: post.value.key.board,
            });
            return Ok((hex_of(&board), hex_of(&thread)));
        }
        if let Some(thread) = changed_entity::<Thread>(entities)? {
            let board = Board::id(&BoardKey {
                slug: thread.value.key.board.clone(),
            });
            return Ok((hex_of(&board), thread.id));
        }
        if let Some(board) = changed_entity::<Board>(entities)? {
            return Ok((board.id, String::new()));
        }
        Ok((String::new(), String::new()))
    }

    pub fn spawn(self: &Arc<Self>, forum: Arc<ForumApi>, content: Arc<Store>) {
        let hub = self.clone();
        tokio::spawn(async move {
            let mut cursor = match forum.last().await {
                Ok(Some(record)) => match record.tx.txid(&forum.root()) {
                    Ok(txid) => Some(txid),
                    Err(error) => {
                        tracing::warn!(%error, "journal cursor");
                        return;
                    }
                },
                Ok(None) => None,
                Err(error) => {
                    tracing::warn!(%error, "journal head");
                    return;
                }
            };
            loop {
                let history_started = Instant::now();
                match forum.history(cursor).await {
                    Ok(records) => {
                        let history_ms = history_started.elapsed().as_secs_f64() * 1000.0;
                        let received = Instant::now();
                        let mut idle = true;
                        for record in records {
                            let Ok(txid) = record.tx.txid(&forum.root()) else {
                                continue;
                            };
                            if Some(txid) == cursor {
                                continue;
                            }
                            idle = false;
                            cursor = Some(txid);
                            let queue_ms = received.elapsed().as_secs_f64() * 1000.0;
                            let function = record.tx.user.call.function.clone();
                            let entities = changed(&forum, &record.result).await;
                            let scope_started = Instant::now();
                            let (board, thread) = match hub.scope(&entities) {
                                Ok(scope) => scope,
                                Err(error) => {
                                    tracing::warn!(%error, %txid, %function, "journal scope");
                                    continue;
                                }
                            };
                            let scope_ms = scope_started.elapsed().as_secs_f64() * 1000.0;
                            let resources_started = Instant::now();
                            let (contents, attachments, transactions) = match hub
                                .resources(&content, &forum, &entities)
                                .await
                            {
                                Ok(resources) => resources,
                                Err(error) => {
                                    tracing::warn!(%error, %txid, %function, "journal resources");
                                    continue;
                                }
                            };
                            let resources_ms = resources_started.elapsed().as_secs_f64() * 1000.0;
                            if history_ms + queue_ms + scope_ms + resources_ms >= 100.0 {
                                tracing::info!(
                                    %txid,
                                    %function,
                                    history_ms,
                                    queue_ms,
                                    scope_ms,
                                    resources_ms,
                                    "slow live update"
                                );
                            }
                            let reaction = match ReactionEvent::from_user(&record.tx.user) {
                                Ok(reaction) => reaction,
                                Err(error) => {
                                    tracing::warn!(%error, %txid, "journal reaction");
                                    continue;
                                }
                            };
                            hub.publish(Event {
                                txid: txid.to_string(),
                                function,
                                reaction,
                                board,
                                thread,
                                entities,
                                contents,
                                attachments,
                                transactions,
                            });
                        }
                        if idle {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                        }
                    }
                    Err(error) => {
                        tracing::warn!(%error, "journal polling");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });
    }
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

struct ChangedEntity<T: Stored> {
    id: String,
    value: Entity<T>,
}

fn changed_entity<T: Stored>(
    entities: &[EntityPayload],
) -> Result<Option<ChangedEntity<T>>, DomainError> {
    let Some(entity) = entities.iter().find(|entity| entity.kind == T::NAMESPACE) else {
        return Ok(None);
    };
    let bytes =
        hex::decode(&entity.value).map_err(|error| DomainError::Store(error.to_string()))?;
    Ok(Some(ChangedEntity {
        id: entity.id.clone(),
        value: bcs::from_bytes(&bytes)?,
    }))
}

async fn changed(forum: &ForumApi, result: &[u8]) -> Vec<EntityPayload> {
    let Ok(output) = bcs::from_bytes::<Output>(result) else {
        return Vec::new();
    };
    if output.entities.is_empty() {
        return Vec::new();
    }
    let values = match forum.entities(&output.entities).await {
        Ok(values) => values,
        Err(error) => {
            tracing::warn!(%error, "journal entities");
            return Vec::new();
        }
    };
    output
        .entities
        .into_iter()
        .zip(values)
        .map(|(entity, value)| EntityPayload {
            kind: entity.namespace,
            id: hex_of(&entity.id),
            value: hex_of(&value),
        })
        .collect()
}
