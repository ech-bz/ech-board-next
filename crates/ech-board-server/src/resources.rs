use std::collections::{BTreeMap, BTreeSet};

use futures_util::stream::{self, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};

use ech_board_entity::Entity;
use ech_board_program::model::{
    Board, BoardPage, Forum, ForumPage, Hash, Post, PostPage, PostV1, Thread, ThreadMeta,
    ThreadPage, ThreadPreview,
};

use crate::content::{Key, Kind, Store};
use crate::error::ServerError;
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
}

impl Resources {
    pub fn extend(&mut self, other: Self) {
        self.contents.extend(other.contents);
        self.media.extend(other.media);
    }

    fn text(&mut self, kind: Kind, hashes: impl IntoIterator<Item = Hash>) {
        self.contents
            .extend(hashes.into_iter().map(|hash| Key::new(kind, hash)));
    }

    fn media(&mut self, kind: Kind, hashes: impl IntoIterator<Item = Hash>) {
        self.media
            .extend(hashes.into_iter().map(|hash| Key::new(kind, hash)));
    }

    pub async fn load(self, store: &Store) -> Result<WithResources<()>, ServerError> {
        let contents = stream::iter(self.contents)
            .map(|key| async move {
                Ok::<_, ServerError>((
                    key.hash,
                    store.optional(key).await?.map(|bytes| bytes.to_vec()),
                ))
            })
            .buffer_unordered(32)
            .try_collect();
        let attachments = stream::iter(self.media)
            .map(|key| async move { Ok::<_, ServerError>((key.hash, store.metadata(key).await?)) })
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
        resources.text(Kind::Plaintext, self.topic_hash);
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
        for post in self.posts.values() {
            resources.extend(post.resources());
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
        resources.text(Kind::Text, self.text_hash);
        resources.text(Kind::Plaintext, self.name_hash);
        resources.text(Kind::Plaintext, self.mod_note_hash);
        resources.text(Kind::Plaintext, self.votes.iter().map(|(hash, _)| *hash));
        resources.media(Kind::Media, self.media_hashes.iter().copied());
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
        match &self.value {
            Post::V1(post) => post.resources(),
        }
    }
}

impl<T: PageResources> WithResources<T> {
    pub async fn load(store: &Store, view: T) -> Result<Self, ServerError> {
        let resources = view.resources().load(store).await?;
        Ok(Self {
            view,
            contents: resources.contents,
            attachments: resources.attachments,
        })
    }
}
