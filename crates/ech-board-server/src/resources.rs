use std::collections::{BTreeMap, BTreeSet};

use futures_util::stream::{self, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};

use ech_board_entity::{Entity, Stored};
use ech_board_program::entity::{
    Board, BoardPage, Forum, ForumKey, ForumPage, Post, PostPage, PostV1, Thread, ThreadKey,
    ThreadMeta, ThreadPage, ThreadPreview,
};
use ech_board_program::error::ForumError;
use ech_board_program::types::Hash;
use ech_db_protocol::error::Reject;

use crate::content::{Key, Kind, Store};
use crate::db::DbError;
use crate::error::DomainError;
use crate::forum::Forum as ForumApi;
use crate::media::MediaMeta;

#[derive(Serialize, Deserialize)]
pub struct WithResources<T> {
    pub view: T,
    pub contents: BTreeMap<Hash, Option<Vec<u8>>>,
    pub attachments: BTreeMap<Hash, Option<MediaMeta>>,
}

#[derive(Default)]
pub struct Resources {
    pub contents: BTreeSet<Key>,
    pub media: BTreeSet<Key>,
    threads: BTreeMap<Hash, Resources>,
}

impl Resources {
    pub fn extend(&mut self, other: Self) {
        self.contents.extend(other.contents);
        self.media.extend(other.media);
        for (id, resources) in other.threads {
            self.threads.entry(id).or_default().extend(resources);
        }
    }

    fn text(&mut self, kind: Kind, hashes: impl IntoIterator<Item = Hash>) {
        self.contents
            .extend(hashes.into_iter().map(|hash| Key::new(kind, hash)));
    }

    fn media(&mut self, kind: Kind, hashes: impl IntoIterator<Item = Hash>) {
        self.media
            .extend(hashes.into_iter().map(|hash| Key::new(kind, hash)));
    }

    pub async fn entity(forum: &ForumApi, namespace: &str, id: Hash) -> Result<Self, DomainError> {
        let resources = match namespace {
            "post" => entity::<Post>(forum, id).await?.resources(),
            "thread" => entity::<Thread>(forum, id).await?.resources(),
            "board" => entity::<Board>(forum, id).await?.resources(),
            "forum" => entity::<Forum>(forum, id).await?.resources(),
            _ => return Err(DomainError::NotFound),
        };
        resources.resolve(forum).await
    }

    pub async fn path(
        forum: &ForumApi,
        board_id: Hash,
        thread_id: Option<Hash>,
        post_id: Option<Hash>,
    ) -> Result<Self, DomainError> {
        let (board, thread, post) = tokio::try_join!(
            entity::<Board>(forum, board_id),
            async {
                match thread_id {
                    Some(id) => entity::<Thread>(forum, id).await.map(Some),
                    None => Ok(None),
                }
            },
            async {
                match post_id {
                    Some(id) => entity::<Post>(forum, id).await.map(Some),
                    None => Ok(None),
                }
            },
        )?;
        let Some(thread) = thread else {
            return Ok(board.resources());
        };
        if thread.key.board != board.key.slug || thread.deleted {
            return Err(DomainError::NotFound);
        }
        let Some(post) = post else {
            return Ok(thread.resources());
        };
        if post.key.board != board.key.slug || post.thread != thread.key.number || post.deleted {
            return Err(DomainError::NotFound);
        }
        let Post::V1(value) = &post.value;
        Ok(value.resources())
    }

    pub async fn forum(forum: &ForumApi) -> Result<Self, DomainError> {
        Ok(entity::<Forum>(forum, Forum::id(&ForumKey {}))
            .await?
            .resources())
    }

    async fn resolve(mut self, forum: &ForumApi) -> Result<Self, DomainError> {
        let threads = std::mem::take(&mut self.threads);
        let mut reads = stream::iter(threads)
            .map(|(id, resources)| async move {
                let thread = entity::<Thread>(forum, id).await?;
                Ok::<_, DomainError>((!thread.deleted).then_some(resources))
            })
            .buffer_unordered(32);
        while let Some(resources) = reads.try_next().await? {
            if let Some(resources) = resources {
                self.extend(resources);
            }
        }
        Ok(self)
    }

    pub async fn load(
        self,
        store: &Store,
        forum: &ForumApi,
    ) -> Result<WithResources<()>, DomainError> {
        let resources = self.resolve(forum).await?;
        let contents = stream::iter(resources.contents)
            .map(|key| async move {
                Ok::<_, DomainError>((
                    key.hash,
                    store.optional(key).await?.map(|bytes| bytes.to_vec()),
                ))
            })
            .buffer_unordered(32)
            .try_collect();
        let attachments = stream::iter(resources.media)
            .map(|key| async move { Ok::<_, DomainError>((key.hash, store.metadata(key).await?)) })
            .buffer_unordered(32)
            .try_collect();
        let (contents, attachments) = tokio::try_join!(contents, attachments)?;
        Ok(WithResources {
            view: (),
            contents,
            attachments,
        })
    }
}

pub trait PageResources {
    fn resources(&self) -> Resources;
}

impl PageResources for Entity<Forum> {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        resources.text(Kind::Plaintext, self.title_hash);
        resources
    }
}

impl PageResources for Entity<Board> {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        resources.text(Kind::Plaintext, self.description_hash);
        resources.media(Kind::Reaction, self.reactions.iter().copied());
        resources
    }
}

impl PageResources for Entity<Thread> {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        if !self.deleted {
            resources.text(Kind::Plaintext, self.topic_hash);
        }
        resources
    }
}

impl PageResources for ThreadMeta {
    fn resources(&self) -> Resources {
        self.thread.resources()
    }
}

impl PageResources for ThreadPreview {
    fn resources(&self) -> Resources {
        let mut resources = self.thread.resources();
        if !self.thread.deleted {
            for post in self.posts.values() {
                let Post::V1(value) = &post.value;
                resources.extend(value.resources());
            }
        }
        resources
    }
}

impl PageResources for ForumPage {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        for board in &self.boards {
            resources.extend(board.resources());
        }
        resources
    }
}

impl PageResources for ThreadPage {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        for post in self.posts.values() {
            resources.extend(post.resources());
        }
        resources
    }
}

impl PageResources for BoardPage {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        for thread in &self.threads {
            resources.extend(thread.resources());
        }
        resources
    }
}

impl PageResources for PostV1 {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        if self.deleted {
            return resources;
        }
        resources.text(Kind::Text, self.text_hash);
        resources.text(Kind::Plaintext, self.name_hash);
        resources.text(Kind::Plaintext, self.mod_note_hash);
        resources.text(Kind::Plaintext, self.votes.iter().map(|(hash, _)| *hash));
        resources.media(
            Kind::Media,
            self.media_hashes
                .iter()
                .filter(|hash| !self.banned_media.contains(hash))
                .copied(),
        );
        resources
    }
}

impl PageResources for PostPage {
    fn resources(&self) -> Resources {
        self.post.resources()
    }
}

impl PageResources for Entity<Post> {
    fn resources(&self) -> Resources {
        let mut resources = Resources::default();
        if !self.deleted {
            let thread = Thread::id(&ThreadKey {
                board: self.key.board.clone(),
                number: self.thread,
            });
            let Post::V1(value) = &self.value;
            resources.threads.insert(thread, value.resources());
        }
        resources
    }
}

impl<T: PageResources> WithResources<T> {
    pub async fn load(store: &Store, forum: &ForumApi, view: T) -> Result<Self, DomainError> {
        let resources = view.resources().load(store, forum).await?;
        Ok(Self {
            view,
            contents: resources.contents,
            attachments: resources.attachments,
        })
    }
}

async fn entity<T: Stored>(forum: &ForumApi, id: Hash) -> Result<Entity<T>, DomainError> {
    let bytes = forum
        .call("debug.entity", bcs::to_bytes(&(T::NAMESPACE, id))?)
        .await
        .map_err(|error| match &error {
            DomainError::Db(DbError::Reject(Reject::Application { bytes }))
                if matches!(
                    bcs::from_bytes::<ForumError>(bytes),
                    Ok(ForumError::NotFound)
                ) =>
            {
                DomainError::NotFound
            }
            _ => error,
        })?;
    let entity: Entity<T> = bcs::from_bytes(&bytes)?;
    if entity.id() != id {
        return Err(DomainError::NotFound);
    }
    Ok(entity)
}
