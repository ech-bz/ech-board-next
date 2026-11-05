use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::broadcast;

use bcs::to_bytes;
use ech_board_entity::{entity_id, Entity};
use ech_board_program::model::{Board, BoardKey, Forum, Post, Thread, ThreadKey};

use crate::content::Store;
use crate::error::ServerError;
use crate::forum::Forum as ForumApi;
use crate::resources::{PageResources, Resources};

pub struct App {
    pub forum: Arc<ForumApi>,
    pub hub: Arc<Hub>,
    pub content: Arc<Store>,
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
pub struct Event {
    pub txid: String,
    pub function: String,
    pub board: String,
    pub thread: String,
    pub entities: Vec<EntityPayload>,
    pub contents: Vec<BlobPayload>,
    pub attachments: Vec<BlobPayload>,
}

type PostScope = ([u8; 32], [u8; 32]);

pub struct Hub {
    sender: broadcast::Sender<Event>,
    scopes: Mutex<HashMap<[u8; 32], PostScope>>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1024);
        Self {
            sender,
            scopes: Mutex::new(HashMap::new()),
        }
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

    async fn scope(&self, forum: &ForumApi, function: &str, args: &[u8]) -> (String, String) {
        let Some(id) = args
            .get(..32)
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        else {
            return (String::new(), String::new());
        };
        match function.split_once('.').map(|(namespace, _)| namespace) {
            Some("board") => match self.thread_of_post(forum, function, args).await {
                Some(thread) => (hex_of(&id), hex_of(&thread)),
                None => (hex_of(&id), String::new()),
            },
            Some("thread") => match self.thread_board(forum, &id).await {
                Some(board) => (hex_of(&board), hex_of(&id)),
                None => (hex_of(&id), String::new()),
            },
            Some("post") => match self.post_scope(forum, &id).await {
                Some((board, thread)) => (hex_of(&board), hex_of(&thread)),
                None => (String::new(), String::new()),
            },
            _ => (String::new(), String::new()),
        }
    }

    async fn thread_board(&self, forum: &ForumApi, id: &[u8; 32]) -> Option<[u8; 32]> {
        let record = forum
            .call("debug.entity", to_bytes(&("thread".to_string(), *id)).ok()?)
            .await
            .ok()?;
        let thread: Entity<Thread> = bcs::from_bytes(&record).ok()?;
        Some(entity_id(
            "board",
            &BoardKey {
                slug: thread.key.board.clone(),
            },
        ))
    }

    async fn thread_of_post(
        &self,
        forum: &ForumApi,
        function: &str,
        args: &[u8],
    ) -> Option<[u8; 32]> {
        if function != "board.create_post" {
            return None;
        }
        let board_id = <[u8; 32]>::try_from(args.get(..32)?).ok()?;
        let number: u64 = bcs::from_bytes(args.get(32..40)?).ok()?;
        let record = forum
            .call(
                "debug.entity",
                to_bytes(&("board".to_string(), board_id)).ok()?,
            )
            .await
            .ok()?;
        let board: Entity<Board> = bcs::from_bytes(&record).ok()?;
        Some(entity_id(
            "thread",
            &ThreadKey {
                number,
                board: board.key.slug.clone(),
            },
        ))
    }

    async fn post_scope(&self, forum: &ForumApi, id: &[u8; 32]) -> Option<([u8; 32], [u8; 32])> {
        if let Some(scope) = self.scopes.lock().ok()?.get(id).copied() {
            return Some(scope);
        }
        let record = forum
            .call("debug.entity", to_bytes(&("post".to_string(), *id)).ok()?)
            .await
            .ok()?;
        let post: Entity<Post> = bcs::from_bytes(&record).ok()?;
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
                board: post.key.board.clone(),
            },
        );
        self.scopes.lock().ok()?.insert(*id, (board, thread));
        Some((board, thread))
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
                match forum.history(cursor).await {
                    Ok(records) if records.is_empty() => {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    Ok(records) => {
                        for record in records {
                            let Ok(txid) = record.tx.txid(&forum.root()) else {
                                continue;
                            };
                            if Some(txid) == cursor {
                                continue;
                            }
                            let function = record.tx.user.call.function.clone();
                            let (board, thread) = hub
                                .scope(&forum, &function, &record.tx.user.call.args)
                                .await;
                            let entities = changed(&record.result);
                            let (contents, attachments) =
                                match hub.resources(&content, &entities).await {
                                    Ok(resources) => resources,
                                    Err(error) => {
                                        tracing::warn!(%error, "journal resources");
                                        tokio::time::sleep(Duration::from_secs(1)).await;
                                        break;
                                    }
                                };
                            hub.publish(Event {
                                txid: txid.to_string(),
                                function,
                                board,
                                thread,
                                entities,
                                contents,
                                attachments,
                            });
                            cursor = Some(txid);
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
