use serde::Deserialize;

type Hash = ech_board_program::model::Hash;
type ThreadArgs = (
    Option<Hash>,
    Option<Hash>,
    Vec<Hash>,
    Option<Hash>,
    Vec<Hash>,
    bool,
    bool,
);
type ThreadPostArgs = (Option<Hash>, Vec<Hash>, Option<Hash>, Vec<Hash>, bool);

#[allow(dead_code)]
#[derive(Deserialize)]
enum PostPart {
    Plain(String),
    Bold(Vec<PostPart>),
    Italic(Vec<PostPart>),
    Code(Vec<PostPart>),
    ReplyTo {
        forum: Hash,
        board: Hash,
        post: Hash,
        hint: String,
    },
    Secret {
        data_nonce: [u8; 12],
        data_ct: Vec<u8>,
        encrypted_keys: Vec<EncryptedKey>,
    },
    Underline(Vec<PostPart>),
    Overline(Vec<PostPart>),
    Spoiler(Vec<PostPart>),
    Strike(Vec<PostPart>),
    Sup(Vec<PostPart>),
    Sub(Vec<PostPart>),
    Link {
        url: String,
        children: Vec<PostPart>,
    },
    Fold {
        title: String,
        children: Vec<PostPart>,
    },
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct EncryptedKey {
    nonce: [u8; 12],
    ct: [u8; 32],
    tag: [u8; 16],
}

#[derive(Default)]
pub struct Expected {
    pub keys: std::collections::BTreeSet<crate::content::Key>,
}

impl Expected {
    fn add(&mut self, kind: crate::content::Kind, hashes: impl IntoIterator<Item = Hash>) {
        self.keys.extend(
            hashes
                .into_iter()
                .map(|hash| crate::content::Key::new(kind, hash)),
        );
    }
}

pub fn expected(function: &str, args: &[u8]) -> Expected {
    decode_expected(function, args).unwrap_or_default()
}

fn decode_expected(function: &str, args: &[u8]) -> Option<Expected> {
    use crate::content::Kind;

    let rest = args.get(32..)?;
    let mut expected = Expected::default();
    match function {
        "board.create_post" => {
            let (text, media, name, votes, _): ThreadPostArgs =
                bcs::from_bytes(args.get(40..)?).ok()?;
            expected.add(Kind::Text, text);
            expected.add(Kind::Plaintext, name.into_iter().chain(votes));
            expected.add(Kind::Media, media);
        }
        "board.create_thread" => {
            let (topic, text, media, name, votes, _, _): ThreadArgs = bcs::from_bytes(rest).ok()?;
            expected.add(Kind::Text, text);
            expected.add(Kind::Plaintext, topic.into_iter().chain(name).chain(votes));
            expected.add(Kind::Media, media);
        }
        "post.set_text" => {
            let (text,): (Option<Hash>,) = bcs::from_bytes(rest).ok()?;
            expected.add(Kind::Text, text);
        }
        "forum.set_title" => {
            let (hash,): (Hash,) = bcs::from_bytes(rest).ok()?;
            expected.add(Kind::Plaintext, [hash]);
        }
        "forum.create_board" => {
            let (_, hash): (String, Option<Hash>) = bcs::from_bytes(rest).ok()?;
            expected.add(Kind::Plaintext, hash);
        }
        "board.set_description" | "thread.set_topic" | "post.set_mod_note" => {
            let (hash,): (Option<Hash>,) = bcs::from_bytes(rest).ok()?;
            expected.add(Kind::Plaintext, hash);
        }
        "board.set_reactions" => {
            let (hashes,): (Vec<Hash>,) = bcs::from_bytes(rest).ok()?;
            expected.add(Kind::Reaction, hashes);
        }
        _ => {}
    }
    Some(expected)
}

pub fn validate(bytes: &[u8]) -> bool {
    bcs::from_bytes::<Vec<PostPart>>(bytes).is_ok()
}
