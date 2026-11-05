use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use bcs::to_bytes;

use ech_board_entity::{Entity, Output};
use ech_board_program::context::ServerContext;
use ech_board_program::error::ForumError;
use ech_board_program::model::Forum as ForumEntity;
use ech_db_protocol::error::Reject;
use ech_db_protocol::id::{Root, Txid};
use ech_db_protocol::value::{Author, Call, Esid, Program, Record, Request, UserPart};
use ech_db_sdk::Domain;

use crate::db::{DbClient, DbError};
use crate::error::ServerError;

pub struct Forum {
    db: DbClient,
    domain: Domain,
    program: Txid,
    upload: UserPart,
}

impl Forum {
    pub const UPLOAD: &'static str = "upload_program";
    pub const PAGE: u64 = 64;

    pub fn new(db: DbClient, domain: Domain, wasm: &[u8]) -> Result<Self, ServerError> {
        let upload = UserPart {
            ctx: Vec::new(),
            call: Call {
                program: Program::Native,
                function: Self::UPLOAD.to_string(),
                args: wasm.to_vec(),
            },
            author: Author::Server,
        };
        let program = domain
            .sign(upload.clone(), Self::context())?
            .txid(&domain.root())?;
        Ok(Self {
            db,
            domain,
            program,
            upload,
        })
    }

    pub fn root(&self) -> Root {
        self.domain.root()
    }

    pub fn program(&self) -> Txid {
        self.program
    }

    pub async fn deploy(&self) -> Result<(), ServerError> {
        let request = self.request(self.upload.clone(), Vec::new())?;
        match self.db.append(&self.root(), &request).await {
            Ok(_) => Ok(()),
            Err(DbError::Reject(Reject::Duplicate)) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn forum_id(&self) -> Result<[u8; 32], ServerError> {
        let bytes = self.call("debug.forum", Vec::new()).await?;
        bytes
            .try_into()
            .map_err(|_| ServerError::BadRequest("forum id".to_string()))
    }

    pub async fn ensure(&self) -> Result<(), ServerError> {
        match self.execute("forum.create", Vec::new()).await {
            Ok(_) => Ok(()),
            Err(ServerError::Db(DbError::Reject(Reject::Application { bytes })))
                if matches!(
                    bcs::from_bytes::<ForumError>(&bytes),
                    Ok(ForumError::ForumExists)
                ) =>
            {
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    pub async fn moderators(&self) -> Result<Vec<Esid>, ServerError> {
        let forum: Entity<ForumEntity> = bcs::from_bytes(
            &self
                .call("forum.meta", self.forum_id().await?.to_vec())
                .await?,
        )?;
        Ok(forum.moderators.clone())
    }

    pub async fn add_moderator(&self, member: Esid) -> Result<Vec<Esid>, ServerError> {
        self.execute(
            "forum.add_moderator",
            to_bytes(&(self.forum_id().await?, member))?,
        )
        .await?;
        self.moderators().await
    }

    pub async fn remove_moderator(&self, member: Esid) -> Result<Vec<Esid>, ServerError> {
        self.execute(
            "forum.remove_moderator",
            to_bytes(&(self.forum_id().await?, member))?,
        )
        .await?;
        self.moderators().await
    }

    pub async fn submit(
        &self,
        user: UserPart,
        decryptions: Vec<Esid>,
    ) -> Result<Output, ServerError> {
        let request = self.request(user, decryptions)?;
        let txid = request.tx.txid(&self.root())?;
        match self.db.append(&self.root(), &request).await {
            Ok(outcome) => decode(&outcome.result),
            Err(DbError::Reject(Reject::Duplicate)) => decode(&self.record(txid).await?.result),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn query(
        &self,
        user: UserPart,
        decryptions: Vec<Esid>,
    ) -> Result<Output, ServerError> {
        let request = self.request(user, decryptions)?;
        match self.db.query(&self.root(), &request).await {
            Ok(outcome) => decode(&outcome.result),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn call(&self, function: &str, args: Vec<u8>) -> Result<Vec<u8>, ServerError> {
        Ok(self
            .query(self.server_part(function, args), Vec::new())
            .await?
            .result)
    }

    pub async fn execute(&self, function: &str, args: Vec<u8>) -> Result<Vec<u8>, ServerError> {
        Ok(self
            .submit(self.server_part(function, args), Vec::new())
            .await?
            .result)
    }

    pub async fn history(&self, from: Option<Txid>) -> Result<Vec<Record>, ServerError> {
        Ok(self
            .db
            .history(&self.root(), "forward", from, Self::PAGE)
            .await?)
    }

    pub async fn last(&self) -> Result<Option<Record>, ServerError> {
        Ok(self
            .db
            .history(&self.root(), "backward", None, 1)
            .await?
            .into_iter()
            .next())
    }

    pub async fn record(&self, txid: Txid) -> Result<Record, ServerError> {
        let mut records = self
            .db
            .history(&self.root(), "forward", Some(txid), 1)
            .await?;
        let record = records
            .first_mut()
            .ok_or_else(|| ServerError::BadRequest(format!("transaction {txid} not found")))?;
        if record.tx.txid(&self.root())? != txid {
            return Err(ServerError::BadRequest(format!(
                "transaction {txid} not found"
            )));
        }
        Ok(records.remove(0))
    }

    fn request(&self, user: UserPart, decryptions: Vec<Esid>) -> Result<Request, ServerError> {
        let tx = self.domain.sign(user, Self::context())?;
        let mut resolved = BTreeMap::new();
        for esid in decryptions {
            resolved.insert(esid, self.domain.decrypt(&esid)?);
        }
        Ok(Request {
            tx,
            decryptions: resolved,
        })
    }

    fn server_part(&self, function: &str, args: Vec<u8>) -> UserPart {
        UserPart {
            ctx: Vec::new(),
            call: Call {
                program: Program::Txid(self.program),
                function: function.to_string(),
                args,
            },
            author: Author::Server,
        }
    }

    fn context() -> Vec<u8> {
        to_bytes(&ServerContext { time: now() }).expect("server context encodes")
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_millis() as u64
}

fn decode(bytes: &[u8]) -> Result<Output, ServerError> {
    bcs::from_bytes(bytes).map_err(Into::into)
}
