use std::collections::{BTreeMap, BTreeSet};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use ech_board_entity::{Changed, Entity, Output};
use ech_board_program::context::{ServerContext, Tripcode, UserRequests};
use ech_board_program::entity::Forum as ForumEntity;
use ech_board_program::error::ForumError;
use ech_board_program::types::Hash;
use ech_db_protocol::error::Reject;
use ech_db_protocol::id::{Root, Txid};
use ech_db_protocol::value::{Author, Call, Esid, Program, Record, Request, Tx, UserPart};
use ech_db_sdk::Domain;

use crate::db::{DbClient, DbError};
use crate::error::DomainError;
use crate::timing::{self, Timer};

pub struct Forum {
    db: DbClient,
    domain: Domain,
    program: Txid,
    upload: UserPart,
}

#[derive(serde::Serialize)]
pub struct AuthorHistoryPage {
    pub entries: Vec<Tx>,
    pub next: Option<Txid>,
    pub length: Option<u64>,
}

pub struct Query {
    pub user: UserPart,
    pub decryptions: Vec<Esid>,
}

pub struct Submission {
    pub user: UserPart,
    pub decryptions: Vec<Esid>,
    pub country: Option<u32>,
    pub trip: Option<Tripcode>,
}

impl Forum {
    pub const UPLOAD: &'static str = "upload_program";
    pub const PAGE: u64 = 64;

    pub fn new(db: DbClient, domain: Domain, wasm: &[u8]) -> Result<Self, DomainError> {
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
            .sign(upload.clone(), Self::context(None, None, now()))?
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

    fn current_program(&self) -> Program {
        Program::Txid(self.program)
    }

    fn check_program(&self, user: &UserPart) -> Result<(), DomainError> {
        if user.call.program != self.current_program() {
            return Err(DomainError::BadRequest(format!(
                "program mismatch: requested {:?}, current {}; reconnect to refresh the program",
                user.call.program, self.program,
            )));
        }
        Ok(())
    }

    pub async fn deploy(&self) -> Result<(), DomainError> {
        let request = self.request(self.upload.clone(), Vec::new(), None, None, now())?;
        match self
            .db
            .append(&self.root(), std::slice::from_ref(&request))
            .await
        {
            Ok(_) => Ok(()),
            Err(DbError::Reject(Reject::Duplicate)) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn forum_id(&self) -> Result<[u8; 32], DomainError> {
        let bytes = self.call("debug.forum", Vec::new()).await?;
        bytes
            .try_into()
            .map_err(|_| DomainError::BadRequest("forum id".to_string()))
    }

    pub async fn entities(&self, changes: &[Changed]) -> Result<Vec<Vec<u8>>, DomainError> {
        let input: Vec<(String, [u8; 32])> = changes
            .iter()
            .map(|change| (change.namespace.clone(), change.id))
            .collect();
        let bytes = self.call("debug.entities", bcs::to_bytes(&input)?).await?;
        Ok(bcs::from_bytes(&bytes)?)
    }

    pub async fn transactions(
        &self,
        txids: BTreeSet<Hash>,
    ) -> Result<BTreeMap<Hash, Tx>, DomainError> {
        if txids.is_empty() {
            return Ok(BTreeMap::new());
        }
        let list: Vec<Hash> = txids.into_iter().collect();
        let bytes = self
            .call("debug.transactions", bcs::to_bytes(&list)?)
            .await?;
        let values: Vec<Tx> = bcs::from_bytes(&bytes)?;
        Ok(list.into_iter().zip(values).collect())
    }

    pub async fn ensure(&self) -> Result<(), DomainError> {
        match self.execute("forum.create", Vec::new()).await {
            Ok(_) => Ok(()),
            Err(DomainError::Db(DbError::Reject(Reject::Application { bytes })))
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

    pub async fn moderators(&self) -> Result<Vec<Esid>, DomainError> {
        let forum: Entity<ForumEntity> = bcs::from_bytes(
            &self
                .call("forum.meta", self.forum_id().await?.to_vec())
                .await?,
        )?;
        Ok(forum.moderators.clone())
    }

    pub async fn add_moderator(&self, member: Esid) -> Result<Vec<Esid>, DomainError> {
        self.execute(
            "forum.add_moderator",
            bcs::to_bytes(&(self.forum_id().await?, member))?,
        )
        .await?;
        self.moderators().await
    }

    pub async fn remove_moderator(&self, member: Esid) -> Result<Vec<Esid>, DomainError> {
        self.execute(
            "forum.remove_moderator",
            bcs::to_bytes(&(self.forum_id().await?, member))?,
        )
        .await?;
        self.moderators().await
    }

    pub async fn append(&self, submissions: Vec<Submission>) -> Result<Vec<Output>, DomainError> {
        self.append_at(submissions, now()).await
    }

    pub async fn append_at(
        &self,
        submissions: Vec<Submission>,
        time: u64,
    ) -> Result<Vec<Output>, DomainError> {
        if submissions.is_empty() {
            return Ok(Vec::new());
        }
        let started = Instant::now();
        let mut requests = Vec::with_capacity(submissions.len());
        let mut txids = Vec::with_capacity(submissions.len());
        for submission in submissions {
            self.check_program(&submission.user)?;
            let request = self.request(
                submission.user,
                submission.decryptions,
                submission.country,
                submission.trip,
                time,
            )?;
            txids.push(request.tx.txid(&self.root())?);
            requests.push(request);
        }
        let prepare_ms = started.elapsed().as_secs_f64() * 1000.0;
        let append_started = Instant::now();
        let outcome = self.db.append(&self.root(), &requests).await;
        let append_ms = append_started.elapsed().as_secs_f64() * 1000.0;
        if prepare_ms + append_ms >= 250.0 {
            tracing::info!(
                transactions = requests.len(),
                prepare_ms,
                append_ms,
                success = outcome.is_ok(),
                "slow database submission"
            );
        }
        match outcome {
            Ok(outcomes) => outcomes
                .iter()
                .map(|outcome| decode(&outcome.result))
                .collect(),
            Err(DbError::Reject(Reject::Duplicate)) if requests.len() == 1 => {
                decode(&self.record(txids[0]).await?.result).map(|output| vec![output])
            }
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(target = "latency", level = "debug", name = "query.database", skip_all,
        fields(root = %self.root(), queries = queries.len()))]
    pub async fn query(&self, queries: Vec<Query>) -> Result<Vec<Output>, DomainError> {
        if queries.is_empty() {
            return Ok(Vec::new());
        }
        let _database = Timer::new("database");
        let mut requests = Vec::with_capacity(queries.len());
        for query in queries {
            self.check_program(&query.user)?;
            requests.push(timing::measure("prepare", || {
                self.request(query.user, query.decryptions, None, None, now())
            })?);
        }
        let outcomes = self.db.query(&self.root(), &requests).await?;
        timing::measure("output_decode", || {
            outcomes
                .iter()
                .map(|outcome| decode(&outcome.result))
                .collect()
        })
    }

    pub async fn call(&self, function: &str, args: Vec<u8>) -> Result<Vec<u8>, DomainError> {
        let mut outputs = self
            .query(vec![Query {
                user: self.server_part(function, args),
                decryptions: Vec::new(),
            }])
            .await?;
        Ok(outputs.remove(0).result)
    }

    pub async fn execute(&self, function: &str, args: Vec<u8>) -> Result<Vec<u8>, DomainError> {
        let mut outputs = self
            .append(vec![Submission {
                user: self.server_part(function, args),
                decryptions: Vec::new(),
                country: None,
                trip: None,
            }])
            .await?;
        Ok(outputs.remove(0).result)
    }

    pub async fn history(&self, from: Option<Txid>) -> Result<Vec<Record>, DomainError> {
        Ok(self
            .db
            .history(&self.root(), "forward", from, Self::PAGE, None)
            .await?
            .0)
    }

    pub async fn last(&self) -> Result<Option<Record>, DomainError> {
        Ok(self
            .db
            .history(&self.root(), "backward", None, 1, None)
            .await?
            .0
            .into_iter()
            .next())
    }

    pub async fn record(&self, txid: Txid) -> Result<Record, DomainError> {
        let (mut records, _) = self
            .db
            .history(&self.root(), "forward", Some(txid), 1, None)
            .await?;
        let record = records
            .first_mut()
            .ok_or_else(|| DomainError::BadRequest(format!("transaction {txid} not found")))?;
        if record.tx.txid(&self.root())? != txid {
            return Err(DomainError::BadRequest(format!(
                "transaction {txid} not found"
            )));
        }
        Ok(records.remove(0))
    }

    pub async fn author_history(
        &self,
        esid: &Esid,
        from: Option<Txid>,
        limit: u32,
    ) -> Result<AuthorHistoryPage, DomainError> {
        let (mut records, length) = self
            .db
            .history(
                &self.root(),
                "backward",
                from,
                u64::from(limit) + 1,
                Some(esid),
            )
            .await?;
        let next = if records.len() > limit as usize {
            Some(records.pop().expect("extra record").tx.txid(&self.root())?)
        } else {
            None
        };
        Ok(AuthorHistoryPage {
            entries: records.into_iter().map(|record| record.tx).collect(),
            next,
            length,
        })
    }

    #[tracing::instrument(
        target = "latency",
        level = "debug",
        name = "query.prepare_request",
        skip_all
    )]
    fn request(
        &self,
        user: UserPart,
        decryptions: Vec<Esid>,
        country: Option<u32>,
        trip: Option<Tripcode>,
        time: u64,
    ) -> Result<Request, DomainError> {
        let tx = self.domain.sign(user, Self::context(country, trip, time))?;
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
            ctx: UserRequests::default().encode(),
            call: Call {
                program: Program::Txid(self.program),
                function: function.to_string(),
                args,
            },
            author: Author::Server,
        }
    }

    pub fn import_part(
        &self,
        function: String,
        args: Vec<u8>,
        country: Option<u32>,
        trip: Option<Tripcode>,
    ) -> UserPart {
        UserPart {
            ctx: UserRequests {
                geo: country.is_some(),
                trip: trip.is_some(),
                postcount: false,
            }
            .encode(),
            call: Call {
                program: Program::Txid(self.program),
                function,
                args,
            },
            author: Author::Server,
        }
    }

    fn context(country: Option<u32>, trip: Option<Tripcode>, time: u64) -> Vec<u8> {
        ServerContext {
            time,
            country,
            trip,
        }
        .encode()
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_millis() as u64
}

#[tracing::instrument(target = "latency", level = "debug", name = "query.decode_output", skip_all,
    fields(bytes = bytes.len()))]
fn decode(bytes: &[u8]) -> Result<Output, DomainError> {
    bcs::from_bytes(bytes).map_err(Into::into)
}
