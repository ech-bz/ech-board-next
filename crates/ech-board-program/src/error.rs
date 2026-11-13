use serde::{Deserialize, Serialize};

use ech_board_entity::EntityError;
use ech_db_guest::GuestError;

#[derive(Serialize, Deserialize, Debug, thiserror::Error)]
pub enum ForumError {
    #[error(transparent)]
    Entity(#[from] EntityError),
    #[error(transparent)]
    Guest(#[from] GuestError),
    #[error("root owner required")]
    RootOwnerRequired,
    #[error("not authorized")]
    NotAuthorized,
    #[error("ban expiry is in the past")]
    InvalidBanExpiry,
    #[error("invalid board slug")]
    InvalidBoardSlug,
    #[error("invalid bump limit")]
    InvalidBumpLimit,
    #[error("invalid max media")]
    InvalidMaxMedia,
    #[error("duplicate reaction")]
    DuplicateReaction,
    #[error("at most eight pinned threads")]
    PinnedThreadLimit,
    #[error("board is read-only")]
    BoardReadOnly,
    #[error("too many attachments")]
    TooManyAttachments,
    #[error("banned")]
    Banned,
    #[error("thread is closed")]
    ThreadClosed,
    #[error("missing post index")]
    MissingPostIndex,
    #[error("invalid post index")]
    InvalidPostIndex,
    #[error("poll needs 2 to 16 choices")]
    InvalidPollSize,
    #[error("duplicate poll choice")]
    DuplicatePollChoice,
    #[error("post is empty")]
    EmptyPost,
    #[error("post requires media")]
    PostRequiresMedia,
    #[error("poll unavailable")]
    PollUnavailable,
    #[error("poll choice count mismatch")]
    InvalidVoteCount,
    #[error("already voted")]
    AlreadyVoted,
    #[error("invalid poll choice")]
    InvalidPollChoice,
    #[error("post deleted")]
    PostDeleted,
    #[error("reaction not allowed")]
    ReactionNotAllowed,
    #[error("reaction intent mismatch")]
    ReactionConflict,
    #[error("invalid reaction count")]
    InvalidReactionCount,
    #[error("media not found")]
    MediaNotFound,
    #[error("media already banned")]
    MediaAlreadyBanned,
    #[error("media not banned")]
    MediaNotBanned,
    #[error("counter overflow")]
    CounterOverflow,
    #[error("not found")]
    NotFound,
    #[error("forum already exists")]
    ForumExists,
    #[error("board already exists")]
    BoardExists,
    #[error("content hash mismatch")]
    InvalidContentHash,
    #[error("invalid board cursor")]
    InvalidBoardCursor,
}

pub type Result<T> = std::result::Result<T, ForumError>;
