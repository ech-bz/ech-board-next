#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Permissions {
    User,
    UserSelfMod,
    ThreadMod,
    ThreadAdmin,
    BoardMod,
    ForumMod,
    Root,
}
