use ech_board_program::model::Hash;
use object_store::path::Path;
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Text,
    Plaintext,
    Media,
    Thumb,
    MediaMeta,
    Reaction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct Key {
    pub kind: Kind,
    pub hash: Hash,
}

impl Key {
    pub fn new(kind: Kind, hash: Hash) -> Self {
        Self { kind, hash }
    }

    pub fn path(self) -> Path {
        let kind = match self.kind {
            Kind::Text => "text",
            Kind::Plaintext => "plaintext",
            Kind::Media => "media",
            Kind::Thumb => "thumb",
            Kind::MediaMeta => "media_meta",
            Kind::Reaction => "reaction",
        };
        let hash = hex::encode(self.hash);
        Path::from(format!("{kind}/{}/{}/{hash}", &hash[..2], &hash[2..4]))
    }

    pub fn metadata(self) -> Self {
        Self::new(Kind::MediaMeta, self.hash)
    }
}
