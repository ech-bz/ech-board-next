use std::collections::BTreeMap;

use ech_board_entity::EntityError;
use ech_db_guest::Bind;
use ech_db_guest::{BigMap, BigSet};
use serde::{Deserialize, Serialize};

use crate::error::{ForumError, Result};

const NODE_CAPACITY: usize = 64;
const NODE_MINIMUM: usize = NODE_CAPACITY / 2;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct BoardOrderKey {
    pub bump: u64,
    pub thread: u64,
}

impl BoardOrderKey {
    pub fn new(thread: u64, bump: u64) -> Self {
        Self { bump, thread }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
struct Link {
    max: BoardOrderKey,
    id: u64,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
enum Node {
    Leaf(Vec<BoardOrderKey>),
    Branch(Vec<Link>),
}

impl Node {
    fn len(&self) -> usize {
        match self {
            Self::Leaf(keys) => keys.len(),
            Self::Branch(children) => children.len(),
        }
    }

    fn max(&self) -> Result<BoardOrderKey> {
        match self {
            Self::Leaf(keys) => keys.last().copied(),
            Self::Branch(children) => children.last().map(|child| child.max),
        }
        .ok_or_else(|| ForumError::Entity(EntityError::InvalidArguments))
    }

    fn split(&mut self) -> Self {
        let middle = self.len() / 2;
        match self {
            Self::Leaf(keys) => Self::Leaf(keys.split_off(middle)),
            Self::Branch(children) => Self::Branch(children.split_off(middle)),
        }
    }

    fn append(&mut self, other: Self) -> Result<()> {
        match (self, other) {
            (Self::Leaf(left), Self::Leaf(mut right)) => left.append(&mut right),
            (Self::Branch(left), Self::Branch(mut right)) => left.append(&mut right),
            _ => return Err(ForumError::Entity(EntityError::InvalidArguments)),
        }
        Ok(())
    }
}

#[derive(Bind, Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
pub struct BoardIndex {
    root: u64,
    next_node: u64,
    #[serde(skip)]
    nodes: BigMap<u64, Node>,
    #[serde(skip)]
    roots: BigSet<u64>,
}

impl BoardIndex {
    pub fn replace(&mut self, previous: Option<BoardOrderKey>, next: BoardOrderKey) -> Result<()> {
        if previous == Some(next) {
            return Ok(());
        }
        let mut edit = Edit {
            index: self,
            pending: BTreeMap::new(),
            loaded: BTreeMap::new(),
        };
        let mut root = edit.index.root;
        if let Some(previous) = previous {
            root = match edit.remove(root, previous)? {
                Some(link) => link.id,
                None => 0,
            };
            while root != 0 {
                match edit.load(root)? {
                    Node::Branch(children) if children.len() == 1 => root = children[0].id,
                    _ => break,
                }
            }
        }
        let mut links = if root == 0 {
            vec![edit.store(Node::Leaf(vec![next]))?]
        } else {
            edit.insert(root, next)?
        };
        root = if links.len() == 1 {
            links.remove(0).id
        } else {
            edit.store(Node::Branch(links))?.id
        };
        let mut pending = vec![root];
        while let Some(id) = pending.pop() {
            if let Some(node) = edit.pending.remove(&id) {
                if let Node::Branch(children) = &node {
                    pending.extend(children.iter().map(|child| child.id));
                }
                edit.index.nodes.insert(&id, &node)?;
            }
        }
        edit.index.roots.insert(&root)?;
        edit.index.root = root;
        Ok(())
    }

    pub fn page(
        &self,
        root: Option<u64>,
        before: Option<BoardOrderKey>,
        limit: usize,
    ) -> Result<(u64, Vec<BoardOrderKey>)> {
        if let Some(root) = root {
            if root == 0 || (root != self.root && !self.roots.contains(&root)?) {
                return Err(ForumError::InvalidBoardCursor);
            }
        }
        let root = root.unwrap_or(self.root);
        if root == 0 || limit == 0 {
            return Ok((root, Vec::new()));
        }
        let mut pending = vec![root];
        let mut keys = Vec::with_capacity(limit);
        while let Some(id) = pending.pop() {
            let node = self
                .nodes
                .get(&id)?
                .ok_or_else(|| ForumError::Entity(EntityError::InvalidArguments))?;
            match node {
                Node::Leaf(entries) => {
                    for key in entries.into_iter().rev() {
                        if before.is_none_or(|before| key < before) {
                            keys.push(key);
                            if keys.len() == limit {
                                return Ok((root, keys));
                            }
                        }
                    }
                }
                Node::Branch(children) => {
                    for (position, child) in children.iter().enumerate() {
                        if position == 0
                            || before.is_none_or(|before| children[position - 1].max < before)
                        {
                            pending.push(child.id);
                        }
                    }
                }
            }
        }
        Ok((root, keys))
    }
}

struct Edit<'a> {
    index: &'a mut BoardIndex,
    pending: BTreeMap<u64, Node>,
    loaded: BTreeMap<u64, Node>,
}

impl Edit<'_> {
    fn load(&mut self, id: u64) -> Result<Node> {
        if let Some(node) = self.pending.get(&id).or_else(|| self.loaded.get(&id)) {
            return Ok(node.clone());
        }
        let node = self
            .index
            .nodes
            .get(&id)?
            .ok_or_else(|| ForumError::Entity(EntityError::InvalidArguments))?;
        self.loaded.insert(id, node.clone());
        Ok(node)
    }

    fn store(&mut self, node: Node) -> Result<Link> {
        let max = node.max()?;
        self.index.next_node = self
            .index
            .next_node
            .checked_add(1)
            .ok_or(ForumError::CounterOverflow)?;
        let id = self.index.next_node;
        self.pending.insert(id, node);
        Ok(Link { max, id })
    }

    fn store_split(&mut self, mut node: Node) -> Result<Vec<Link>> {
        if node.len() > NODE_CAPACITY {
            let right = node.split();
            Ok(vec![self.store(node)?, self.store(right)?])
        } else {
            Ok(vec![self.store(node)?])
        }
    }

    fn insert(&mut self, id: u64, key: BoardOrderKey) -> Result<Vec<Link>> {
        let mut node = self.load(id)?;
        match &mut node {
            Node::Leaf(keys) => {
                let position = keys
                    .binary_search(&key)
                    .err()
                    .ok_or_else(|| ForumError::Entity(EntityError::InvalidArguments))?;
                keys.insert(position, key);
            }
            Node::Branch(children) => {
                let position = children
                    .partition_point(|child| child.max < key)
                    .min(children.len() - 1);
                let replacement = self.insert(children[position].id, key)?;
                children.splice(position..=position, replacement);
            }
        }
        self.store_split(node)
    }

    fn remove(&mut self, id: u64, key: BoardOrderKey) -> Result<Option<Link>> {
        let mut node = self.load(id)?;
        match &mut node {
            Node::Leaf(keys) => {
                let position = keys
                    .binary_search(&key)
                    .map_err(|_| ForumError::Entity(EntityError::InvalidArguments))?;
                keys.remove(position);
            }
            Node::Branch(children) => {
                let position = children.partition_point(|child| child.max < key);
                let child = children
                    .get(position)
                    .ok_or_else(|| ForumError::Entity(EntityError::InvalidArguments))?;
                if let Some(replacement) = self.remove(child.id, key)? {
                    children[position] = replacement;
                    if children.len() > 1 && self.load(replacement.id)?.len() < NODE_MINIMUM {
                        let left = position.saturating_sub(1);
                        let mut combined = self.load(children[left].id)?;
                        combined.append(self.load(children[left + 1].id)?)?;
                        let replacements = self.store_split(combined)?;
                        children.splice(left..=left + 1, replacements);
                    }
                } else {
                    children.remove(position);
                }
            }
        }
        if node.len() == 0 {
            Ok(None)
        } else {
            self.store(node).map(Some)
        }
    }
}
