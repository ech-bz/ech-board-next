use ech_board_entity::Functions;

use crate::debug::Debug;
use crate::entity::{Board, Forum, Post, Thread};
use crate::error::ForumError;

pub fn registry() -> Functions<ForumError> {
    let mut functions = Functions::new();

    functions.add("forum.create", Forum::create);
    functions.add("forum.meta", Forum::meta);
    functions.add("forum.page", Forum::page);
    functions.add("forum.set_title", Forum::set_title);
    functions.add("forum.add_moderator", Forum::add_moderator);
    functions.add("forum.remove_moderator", Forum::remove_moderator);
    functions.add("forum.ban", Forum::ban);
    functions.add("forum.unban", Forum::unban);
    functions.add("forum.ban_list", Forum::ban_list);

    functions.add("board.create", Board::create);
    functions.add("board.meta", Board::meta);
    functions.add("board.page", Board::page);
    functions.add("board.add_moderator", Board::add_moderator);
    functions.add("board.remove_moderator", Board::remove_moderator);
    functions.add("board.ban", Board::ban);
    functions.add("board.unban", Board::unban);
    functions.add("board.ban_list", Board::ban_list);
    functions.add("board.set_readonly", Board::set_readonly);
    functions.add("board.set_bump_limit", Board::set_bump_limit);
    functions.add("board.set_max_media", Board::set_max_media);
    functions.add("board.set_description", Board::set_description);
    functions.add("board.set_ignore_forum_bans", Board::set_ignore_forum_bans);
    functions.add("board.set_reactions", Board::set_reactions);
    functions.add("board.set_pinned", Board::set_pinned);

    functions.add("thread.create", Thread::create);
    functions.add("thread.import", Thread::import);
    functions.add("thread.meta", Thread::meta);
    functions.add("thread.page", Thread::page);
    functions.add("thread.set_closed", Thread::set_closed);
    functions.add("thread.set_pinned", Thread::set_pinned);
    functions.add("thread.set_deleted", Thread::set_deleted);
    functions.add("thread.set_topic", Thread::set_topic);
    functions.add("thread.set_admin", Thread::set_admin);
    functions.add("thread.add_moderator", Thread::add_moderator);
    functions.add("thread.remove_moderator", Thread::remove_moderator);
    functions.add("thread.ban", Thread::ban);
    functions.add("thread.unban", Thread::unban);
    functions.add("thread.ban_list", Thread::ban_list);

    functions.add("post.create", Post::create);
    functions.add("post.import", Post::import);
    functions.add("post.get", Post::get);
    functions.add("post.set_text", Post::set_text);
    functions.add("post.set_deleted", Post::set_deleted);
    functions.add("post.vote", Post::vote);
    functions.add("post.react", Post::react);
    functions.add("post.ban_media", Post::ban_media);
    functions.add("post.unban_media", Post::unban_media);
    functions.add("post.set_banned", Post::set_banned);
    functions.add("post.set_mod_note", Post::set_mod_note);

    functions.add_raw("debug.entity", Debug::entity);
    functions.add_raw("debug.entities", Debug::entities);
    functions.add("debug.changes", Debug::changes);
    functions.add("debug.transactions", Debug::transactions);
    functions.add("debug.history", Debug::history);
    functions.add("debug.forum", Debug::forum);

    functions
}
