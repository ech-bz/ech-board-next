use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::broadcast;

use bcs::to_bytes;
use ech_board_entity::{entity_id, Entity, Record};
use ech_board_program::model::{Board, BoardKey, Forum, Hash, Post, Thread, ThreadKey};
use ech_db_protocol::value::{Author, UserPart};

use crate::content::Store;
use crate::error::ServerError;
use crate::forum::Forum as ForumApi;
use crate::geo::Geo;
use crate::resources::{PageResources, Resources};
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
    fn from_user(user: &UserPart) -> Result<Option<Self>, ServerError> {
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
        entities: &[EntityPayload],
    ) -> Result<(Vec<BlobPayload>, Vec<BlobPayload>), ServerError> {
        let mut resources = Resources::default();
        for entity in entities {
            let value = hex::decode(&entity.value)
                .map_err(|error| ServerError::Store(error.to_string()))?;
            let next = match entity.kind.as_str() {
                "post" => bcs::from_bytes::<Entity<Post>>(&value)?.resources(),
                "thread" => bcs::from_bytes::<Entity<Thread>>(&value)?.resources(),
                "board" => bcs::from_bytes::<Entity<Board>>(&value)?.resources(),
                "forum" => bcs::from_bytes::<Entity<Forum>>(&value)?.resources(),
                _ => continue,
            };
            resources.extend(next);
        }
        let loaded = resources.load(store).await?;
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
            .collect::<Result<_, ServerError>>()?;
        Ok((contents, attachments))
    }

    async fn scope(
        &self,
        forum: &ForumApi,
        function: &str,
        args: &[u8],
        entities: &[EntityPayload],
    ) -> Result<(String, String), ServerError> {
        let Some(id) = args
            .get(..32)
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        else {
            return Ok((String::new(), String::new()));
        };
        let scope = match function.split_once('.').map(|(namespace, _)| namespace) {
            Some("board") if function == "board.create_post" => {
                let board = event_entity::<Board>(forum, entities, &id).await?;
                let number = args
                    .get(32..40)
                    .ok_or_else(|| ServerError::BadRequest("missing thread number".into()))?;
                let thread = entity_id(
                    "thread",
                    &ThreadKey {
                        number: bcs::from_bytes(number)?,
                        board: board.key.slug,
                    },
                );
                (hex_of(&id), hex_of(&thread))
            }
            Some("board") => (hex_of(&id), String::new()),
            Some("thread") => {
                let thread = event_entity::<Thread>(forum, entities, &id).await?;
                let board = entity_id(
                    "board",
                    &BoardKey {
                        slug: thread.key.board,
                    },
                );
                (hex_of(&board), hex_of(&id))
            }
            Some("post") => {
                let post = event_entity::<Post>(forum, entities, &id).await?;
                let board = entity_id(
                    "board",
                    &BoardKey {
                        slug: post.key.board.clone(),
                    },
                );
                let thread = entity_id(
                    "thread",
                    &ThreadKey {
                        number: post.thread,
                        board: post.key.board,
                    },
                );
                (hex_of(&board), hex_of(&thread))
            }
            _ => (String::new(), String::new()),
        };
        Ok(scope)
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
                            let queue_ms = received.elapsed().as_secs_f64() * 1000.0;
                            let function = record.tx.user.call.function.clone();
                            let entities = changed(&record.result);
                            let scope_started = Instant::now();
                            let (board, thread) = match hub
                                .scope(&forum, &function, &record.tx.user.call.args, &entities)
                                .await
                            {
                                Ok(scope) => scope,
                                Err(error) => {
                                    tracing::warn!(%error, %txid, %function, "journal scope");
                                    tokio::time::sleep(Duration::from_secs(1)).await;
                                    break;
                                }
                            };
                            let scope_ms = scope_started.elapsed().as_secs_f64() * 1000.0;
                            let resources_started = Instant::now();
                            let (contents, attachments) = match hub
                                .resources(&content, &entities)
                                .await
                            {
                                Ok(resources) => resources,
                                Err(error) => {
                                    tracing::warn!(%error, %txid, %function, "journal resources");
                                    tokio::time::sleep(Duration::from_secs(1)).await;
                                    break;
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
                                    tokio::time::sleep(Duration::from_secs(1)).await;
                                    break;
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
                            });
                            cursor = Some(txid);
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

async fn event_entity<T: Record>(
    forum: &ForumApi,
    entities: &[EntityPayload],
    id: &[u8; 32],
) -> Result<Entity<T>, ServerError> {
    let id_hex = hex_of(id);
    let bytes = match entities
        .iter()
        .find(|entity| entity.kind == T::NAMESPACE && entity.id == id_hex)
    {
        Some(entity) => {
            hex::decode(&entity.value).map_err(|error| ServerError::Store(error.to_string()))?
        }
        None => {
            forum
                .call("debug.entity", to_bytes(&(T::NAMESPACE, *id))?)
                .await?
        }
    };
    Ok(bcs::from_bytes(&bytes)?)
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn changed(result: &[u8]) -> Vec<EntityPayload> {
    let Ok(output) = bcs::from_bytes::<ech_board_entity::Output>(result) else {
        return Vec::new();
    };
    output
        .entities
        .into_iter()
        .map(|entity| EntityPayload {
            kind: entity.namespace,
            id: hex_of(&entity.id),
            value: hex_of(&entity.value),
        })
        .collect()
}
