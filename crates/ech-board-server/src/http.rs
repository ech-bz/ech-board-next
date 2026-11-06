use std::time::Instant;

use actix_multipart::form::bytes::Bytes as MultipartBytes;
use actix_multipart::form::MultipartForm;
use actix_web::http::header;
use actix_web::{web, HttpResponse};
use bcs::{from_bytes, to_bytes};
use futures_util::stream::{self, StreamExt as _, TryStreamExt as _};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use ech_board_entity::{Entity, HistoryEntry};
use ech_board_program::context::ServerContext;
use ech_board_program::model::{
    Board, BoardKey, BoardPage, Esid, Forum, ForumPage, Hash, Post, Thread, ThreadMeta, ThreadPage,
};
use ech_db_protocol::id::Txid;
use ech_db_protocol::value::{Author, UserPart};

use crate::assets;
use crate::error::ServerError;
use crate::postpart;
use crate::realtime::App;
use crate::resources::{PageResources, WithResources};

const CONTENT_TYPE: &str = "application/octet-stream";
const FEED_LIMIT: u32 = 64;
const BODY_LIMIT: usize = 64 * 1024 * 1024;
const QUERY_CONCURRENCY: usize = 8;

pub fn routes(config: &mut web::ServiceConfig) {
    config
        .app_data(web::PayloadConfig::new(BODY_LIMIT))
        .route("/health", web::get().to(health))
        .route("/api/root", web::get().to(root_info))
        .route("/sse/forum/{id}", web::get().to(sse_forum))
        .route("/sse/thread/{id}", web::get().to(sse_thread))
        .route("/sse/board/{id}", web::get().to(sse_board))
        .route("/api/submit", web::post().to(submit_handler))
        .route("/api/query", web::post().to(query_handler))
        .route("/api/feed/{id}", web::get().to(feed_page))
        .route(
            "/api/debug/entity/{namespace}/{id}",
            web::get().to(debug_entity),
        )
        .route("/api/debug/history/{id}", web::get().to(debug_history))
        .route("/api/content", web::post().to(assets::content_put))
        .route("/api/content/{hash}", web::get().to(assets::content_get))
        .route("/api/media", web::post().to(assets::media_put))
        .route(
            "/api/media/{hash}/meta",
            web::get().to(assets::metadata_get),
        )
        .route("/api/media/{hash}", web::get().to(assets::media_get))
        .route("/content/{hash}", web::get().to(assets::media_get))
        .route("/thumbnail/{hash}", web::get().to(assets::thumbnail_get))
        .route("/reaction/{hash}", web::get().to(assets::reaction_get));
}

#[derive(Serialize, Deserialize)]
pub struct Signed {
    pub user: UserPart,
    pub decryptions: Vec<Esid>,
}

#[derive(MultipartForm)]
struct SubmitForm {
    signed: MultipartBytes,
    #[multipart(limit = "64mb")]
    blob: Vec<MultipartBytes>,
}

#[derive(Deserialize)]
struct Feed {
    before: Option<u64>,
    limit: u32,
}

async fn health() -> &'static str {
    "ok"
}

async fn root_info(app: web::Data<App>) -> web::Json<serde_json::Value> {
    web::Json(serde_json::json!({
        "root": app.forum.root().to_string(),
        "program": app.forum.program().to_string(),
    }))
}

const THREAD_BOARD_EVENTS: &[&str] = &[
    "board.set_reactions",
    "board.add_moderator",
    "board.remove_moderator",
];

const THREAD_FORUM_EVENTS: &[&str] = &[
    "forum.add_moderator",
    "forum.remove_moderator",
    "forum.set_title",
];

enum Subscription {
    Forum,
    Thread { thread: [u8; 32], board: [u8; 32] },
    Board { board: [u8; 32] },
}

async fn sse_forum(
    app: web::Data<App>,
    id: web::Path<String>,
) -> Result<HttpResponse, ServerError> {
    parse_public(&id)?;
    Ok(events(&app, Subscription::Forum))
}

async fn sse_thread(
    app: web::Data<App>,
    id: web::Path<String>,
) -> Result<HttpResponse, ServerError> {
    let thread = parse_public(&id)?;
    let record = app
        .forum
        .call("debug.entity", to_bytes(&("thread".to_string(), thread))?)
        .await?;
    let entity: Entity<Thread> = from_bytes(&record)?;
    let board = ech_board_entity::entity_id(
        "board",
        &BoardKey {
            slug: entity.key.board.clone(),
        },
    );
    Ok(events(&app, Subscription::Thread { thread, board }))
}

async fn sse_board(
    app: web::Data<App>,
    id: web::Path<String>,
) -> Result<HttpResponse, ServerError> {
    let board = parse_public(&id)?;
    Ok(events(&app, Subscription::Board { board }))
}

fn events(app: &App, subscription: Subscription) -> HttpResponse {
    let receiver = app.hub.subscribe();
    let body = stream::unfold(
        (receiver, subscription),
        |(mut receiver, subscription)| async move {
            loop {
                match receiver.recv().await {
                    Ok(event) => {
                        if !visible(&subscription, &event) {
                            continue;
                        }
                        let data = serde_json::to_string(&event).ok()?;
                        let chunk = web::Bytes::from(format!("event: append\ndata: {data}\n\n"));
                        return Some((
                            Ok::<web::Bytes, actix_web::Error>(chunk),
                            (receiver, subscription),
                        ));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => return None,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    );
    let head = stream::once(async {
        Ok::<web::Bytes, actix_web::Error>(web::Bytes::from_static(
            b"retry: 100\nevent: ready\ndata: {}\n\n",
        ))
    });
    HttpResponse::Ok()
        .insert_header((header::CONTENT_TYPE, "text/event-stream"))
        .insert_header((header::CACHE_CONTROL, "no-cache"))
        .streaming(head.chain(body))
}

fn visible(subscription: &Subscription, event: &crate::realtime::Event) -> bool {
    let name = event.function.as_str();
    match subscription {
        Subscription::Forum => name.starts_with("forum."),
        Subscription::Thread { thread, board } => {
            if event.thread == hex_of(thread) {
                return true;
            }
            if event.board == hex_of(board) && THREAD_BOARD_EVENTS.contains(&name) {
                return true;
            }
            THREAD_FORUM_EVENTS.contains(&name)
        }
        Subscription::Board { board } => {
            if event.board == hex_of(board) {
                return true;
            }
            THREAD_FORUM_EVENTS.contains(&name)
        }
    }
}

async fn submit_handler(
    app: web::Data<App>,
    form: MultipartForm<SubmitForm>,
) -> Result<HttpResponse, ServerError> {
    let started = Instant::now();
    let signed: Signed = from_bytes(&form.signed.data)?;
    let function = signed.user.call.function.clone();
    let content = submit_content(&app, &form, &signed).await;
    let content_ms = started.elapsed().as_secs_f64() * 1000.0;
    if let Err(error) = content {
        tracing::warn!(%error, %function, content_ms, "submit content rejected");
        return Err(error);
    }
    let transaction_started = Instant::now();
    let output = app.forum.submit(signed.user, signed.decryptions).await;
    let transaction_ms = transaction_started.elapsed().as_secs_f64() * 1000.0;
    let output = match output {
        Ok(output) => output,
        Err(error) => {
            tracing::warn!(%error, %function, content_ms, transaction_ms, "submit rejected");
            return Err(error);
        }
    };
    let total_ms = started.elapsed().as_secs_f64() * 1000.0;
    if total_ms >= 500.0 {
        tracing::info!(%function, content_ms, transaction_ms, total_ms, "slow submit");
    }
    Ok(HttpResponse::Ok()
        .content_type(CONTENT_TYPE)
        .insert_header((
            "Server-Timing",
            format!(
                "content;dur={content_ms:.2}, transaction;dur={transaction_ms:.2}, total;dur={total_ms:.2}"
            ),
        ))
        .body(output.result))
}

async fn submit_content(app: &App, form: &SubmitForm, signed: &Signed) -> Result<(), ServerError> {
    let expected = postpart::expected(&signed.user.call.function, &signed.user.call.args);
    let mut received = std::collections::BTreeSet::new();
    for part in &form.blob {
        let hash = crate::content::hash(&part.data);
        let keys: Vec<_> = expected
            .keys
            .iter()
            .filter(|key| key.hash == hash)
            .copied()
            .collect();
        if keys.is_empty() {
            return Err(ServerError::BadRequest("unexpected content".to_string()));
        }
        for key in keys {
            if received.insert(key) {
                app.content.upload(key, part.data.clone()).await?;
            }
        }
    }
    for key in expected.keys {
        if received.contains(&key) {
            continue;
        }
        let ready = match key.kind {
            crate::content::Kind::Media | crate::content::Kind::Reaction => {
                app.content.exists(key).await? && app.content.exists(key.metadata()).await?
            }
            _ => app.content.exists(key).await?,
        };
        if !ready {
            return Err(ServerError::BadRequest("missing content".to_string()));
        }
    }
    Ok(())
}

async fn query_handler(app: web::Data<App>, body: web::Bytes) -> Result<HttpResponse, ServerError> {
    let started = Instant::now();
    let batch: Vec<Signed> = from_bytes(&body)?;
    let results: Vec<(Vec<u8>, f64, f64)> = stream::iter(batch)
        .map(|signed| {
            let app = &app;
            async move {
                let function = signed.user.call.function.clone();
                let query_started = Instant::now();
                let output = app.forum.query(signed.user, signed.decryptions).await;
                let db_ms = query_started.elapsed().as_secs_f64() * 1000.0;
                let output = match output {
                    Ok(output) => output,
                    Err(error) => {
                        tracing::warn!(%error, %function, db_ms, "query rejected");
                        return Err(error);
                    }
                };
                let resources_started = Instant::now();
                let result = hydrate(app, &function, output.result).await;
                let resources_ms = resources_started.elapsed().as_secs_f64() * 1000.0;
                let total_ms = query_started.elapsed().as_secs_f64() * 1000.0;
                let result = match result {
                    Ok(result) => result,
                    Err(error) => {
                        tracing::warn!(%error, %function, db_ms, resources_ms, total_ms, "query resources failed");
                        return Err(error);
                    }
                };
                if total_ms >= 100.0 {
                    tracing::info!(%function, db_ms, resources_ms, total_ms, "slow query");
                }
                Ok((result, db_ms, resources_ms))
            }
        })
        .buffered(QUERY_CONCURRENCY)
        .try_collect()
        .await?;
    let mut timing = match results.as_slice() {
        [(_, db_ms, resources_ms)] => {
            format!("db;dur={db_ms:.2}, resources;dur={resources_ms:.2}, ")
        }
        _ => String::new(),
    };
    let results: Vec<Vec<u8>> = results.into_iter().map(|(result, _, _)| result).collect();
    let body = to_bytes(&results)?;
    let total_ms = started.elapsed().as_secs_f64() * 1000.0;
    timing.push_str(&format!("total;dur={total_ms:.2}"));
    Ok(HttpResponse::Ok()
        .content_type(CONTENT_TYPE)
        .insert_header(("Server-Timing", timing))
        .body(body))
}

async fn hydrate(app: &App, function: &str, result: Vec<u8>) -> Result<Vec<u8>, ServerError> {
    match function {
        "forum.meta" => view::<Entity<Forum>>(app, &result).await,
        "board.meta" => view::<Entity<Board>>(app, &result).await,
        "thread.meta" => view::<ThreadMeta>(app, &result).await,
        "forum.page" => view::<ForumPage>(app, &result).await,
        "board.page" | "board.by_id" => view::<BoardPage>(app, &result).await,
        "thread.page" | "thread.by_number" | "thread.by_id" => {
            view::<ThreadPage>(app, &result).await
        }
        "post.get" => view::<Entity<Post>>(app, &result).await,
        _ => Ok(result),
    }
}

async fn view<T>(app: &App, result: &[u8]) -> Result<Vec<u8>, ServerError>
where
    T: PageResources + serde::de::DeserializeOwned + Serialize,
{
    let view: T = from_bytes(result)?;
    let resources = WithResources::load(&app.content, view).await?;
    Ok(to_bytes(&resources)?)
}

async fn feed_page(
    app: web::Data<App>,
    id: web::Path<String>,
    query: web::Query<Feed>,
) -> Result<web::Json<serde_json::Value>, ServerError> {
    if query.limit == 0 || query.limit > FEED_LIMIT {
        return Err(ServerError::BadRequest(format!(
            "limit must be between 1 and {FEED_LIMIT}"
        )));
    }
    let id = parse_public(&id)?;
    let result = app
        .forum
        .call("debug.history", to_bytes(&(id, query.before, query.limit))?)
        .await?;
    let history: Vec<HistoryEntry> = from_bytes(&result)?;
    let next = history
        .last()
        .filter(|entry| entry.sequence > 1)
        .map(|entry| entry.sequence);
    let mut entries = Vec::with_capacity(history.len());
    for entry in &history {
        let record = app.forum.record(Txid::new(entry.txid)).await?;
        let context: ServerContext = from_bytes(&record.tx.server.ctx)?;
        entries.push(serde_json::json!({
            "txid": hex_of(&entry.txid),
            "timestamp_ms": context.time,
            "sender": sender(&record.tx.user.author),
            "function": record.tx.user.call.function,
            "args": hex_of(&record.tx.user.call.args),
            "result": hex_of(&record.result),
        }));
    }
    Ok(web::Json(serde_json::json!({
        "entity": hex_of(&id),
        "entries": entries,
        "next": next.map(|sequence| sequence.to_string()),
    })))
}

fn esid_hex(esid: &Esid) -> String {
    hex_of(&to_bytes(esid).expect("esid encodes"))
}

fn sender(author: &Author) -> String {
    match author {
        Author::User { esid, .. } => esid_hex(esid),
        Author::Server => "server".to_string(),
    }
}

async fn debug_entity(
    app: web::Data<App>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ServerError> {
    let (namespace, id) = path.into_inner();
    let id = parse_public(&id)?;
    let result = app
        .forum
        .call("debug.entity", to_bytes(&(namespace, id))?)
        .await?;
    Ok(encoded(&result))
}

async fn debug_history(
    app: web::Data<App>,
    id: web::Path<String>,
    query: web::Query<Feed>,
) -> Result<HttpResponse, ServerError> {
    let id = parse_public(&id)?;
    let result = app
        .forum
        .call("debug.history", to_bytes(&(id, query.before, query.limit))?)
        .await?;
    Ok(encoded(&result))
}

fn parse_public(text: &str) -> Result<[u8; 32], ServerError> {
    let text = text.strip_prefix("0x").unwrap_or(text);
    let bytes = hex::decode(text).map_err(|_| ServerError::BadRequest("key hex".to_string()))?;
    bytes
        .try_into()
        .map_err(|_| ServerError::BadRequest("key length".to_string()))
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn encoded(bytes: &[u8]) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((header::CONTENT_TYPE, CONTENT_TYPE))
        .body(bytes.to_vec())
}

pub fn admin_routes(config: &mut web::ServiceConfig) {
    config
        .route("/moderators", web::get().to(admin_moderators))
        .route("/moderators", web::post().to(admin_add_moderator))
        .route("/boards", web::post().to(admin_create_board))
        .route(
            "/moderators/{esid}",
            web::delete().to(admin_remove_moderator),
        );
}

#[derive(Deserialize)]
struct BoardBody {
    slug: String,
}

async fn admin_create_board(
    app: web::Data<App>,
    body: web::Json<BoardBody>,
) -> Result<web::Json<serde_json::Value>, ServerError> {
    let id = app.forum.forum_id().await?;
    app.forum
        .execute(
            "forum.create_board",
            to_bytes(&(id, body.slug.clone(), Option::<Hash>::None))?,
        )
        .await?;
    Ok(web::Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ModeratorBody {
    esid: String,
}

async fn admin_moderators(
    app: web::Data<App>,
) -> Result<web::Json<serde_json::Value>, ServerError> {
    Ok(web::Json(moderators_json(&app.forum.moderators().await?)))
}

async fn admin_add_moderator(
    app: web::Data<App>,
    body: web::Json<ModeratorBody>,
) -> Result<web::Json<serde_json::Value>, ServerError> {
    let esid = parse_esid(&body.esid)?;
    Ok(web::Json(moderators_json(
        &app.forum.add_moderator(esid).await?,
    )))
}

async fn admin_remove_moderator(
    app: web::Data<App>,
    esid: web::Path<String>,
) -> Result<web::Json<serde_json::Value>, ServerError> {
    let esid = parse_esid(&esid)?;
    Ok(web::Json(moderators_json(
        &app.forum.remove_moderator(esid).await?,
    )))
}

fn moderators_json(members: &[Esid]) -> serde_json::Value {
    serde_json::json!({
        "moderators": members
            .iter()
            .map(|esid| hex_of(&to_bytes(esid).expect("esid encodes")))
            .collect::<Vec<_>>(),
    })
}

fn parse_esid(text: &str) -> Result<Esid, ServerError> {
    let bytes = hex::decode(text.strip_prefix("0x").unwrap_or(text))
        .map_err(|_| ServerError::BadRequest("esid hex".to_string()))?;
    from_bytes(&bytes).map_err(|_| ServerError::BadRequest("esid encoding".to_string()))
}
