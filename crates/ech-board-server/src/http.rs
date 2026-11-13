use std::net::IpAddr;
use std::time::Instant;

use actix_multipart::form::bytes::Bytes as MultipartBytes;
use actix_multipart::form::text::Text;
use actix_multipart::form::MultipartForm;
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use bcs::{from_bytes, to_bytes};
use futures_util::stream::{self, StreamExt as _, TryStreamExt as _};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::Instrument;

use ech_board_entity::{Entity, Stored};
use ech_board_program::context::UserRequests;
use ech_board_program::entity::{
    Board, BoardKey, BoardPage, Forum, ForumPage, PostPage, Thread, ThreadMeta, ThreadPage,
};
use ech_board_program::types::{Esid, Hash};
use ech_db_protocol::id::Txid;
use ech_db_protocol::value::{Author, UserPart};

use crate::assets;
use crate::error::DomainError;
use crate::postpart;
use crate::realtime::App;
use crate::resources::{PageResources, WithResources};
use crate::timing::{self, Timer};

const CONTENT_TYPE: &str = "application/octet-stream";
const HISTORY_LIMIT: u32 = 64;
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
        .route("/api/submit", web::post().to(submit_user))
        .service(
            web::resource("/api/query")
                .wrap(actix_web::middleware::from_fn(timing::middleware))
                .route(web::post().to(query_user)),
        )
        .route(
            "/api/debug/entity/{namespace}/{id}",
            web::get().to(debug_entity),
        )
        .route(
            "/api/debug/history/{namespace}/{id}",
            web::get().to(debug_history),
        )
        .route("/api/history/author/{esid}", web::get().to(author_history))
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
    trip: Option<Text<String>>,
}

#[derive(Deserialize)]
struct History {
    before: Option<u64>,
    limit: u32,
}

#[derive(Deserialize)]
struct AuthorHistory {
    from: Option<String>,
    limit: u32,
}

async fn health() -> &'static str {
    "ok"
}

async fn root_info(app: web::Data<App>) -> web::Json<serde_json::Value> {
    web::Json(connection_info(&app))
}

fn connection_info(app: &App) -> serde_json::Value {
    serde_json::json!({
        "root": app.forum.root().to_string(),
        "program": app.forum.program().to_string(),
    })
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
) -> Result<HttpResponse, DomainError> {
    parse_public(&id)?;
    Ok(events(&app, Subscription::Forum))
}

async fn sse_thread(
    app: web::Data<App>,
    id: web::Path<String>,
) -> Result<HttpResponse, DomainError> {
    let thread = parse_public(&id)?;
    let record = app
        .forum
        .call("debug.entity", to_bytes(&("thread".to_string(), thread))?)
        .await?;
    let entity: Entity<Thread> = from_bytes(&record)?;
    let board = Board::id(&BoardKey {
        slug: entity.key.board.clone(),
    });
    Ok(events(&app, Subscription::Thread { thread, board }))
}

async fn sse_board(
    app: web::Data<App>,
    id: web::Path<String>,
) -> Result<HttpResponse, DomainError> {
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
    let ready = format!(
        "retry: 100\nevent: ready\ndata: {}\n\n",
        connection_info(app)
    );
    let head =
        stream::once(async move { Ok::<web::Bytes, actix_web::Error>(web::Bytes::from(ready)) });
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

fn require_user(signed: &Signed) -> Result<(), DomainError> {
    match signed.user.author {
        Author::User { .. } => Ok(()),
        Author::Server => Err(DomainError::BadRequest(
            "server author is only accepted on the admin port".to_string(),
        )),
    }
}

async fn submit_user(
    app: web::Data<App>,
    req: HttpRequest,
    form: MultipartForm<SubmitForm>,
) -> Result<HttpResponse, DomainError> {
    let signed: Signed = from_bytes(&form.signed.data)?;
    require_user(&signed)?;
    submit_core(app, req, form, signed).await
}

async fn submit_admin(
    app: web::Data<App>,
    req: HttpRequest,
    form: MultipartForm<SubmitForm>,
) -> Result<HttpResponse, DomainError> {
    let signed: Signed = from_bytes(&form.signed.data)?;
    submit_core(app, req, form, signed).await
}

async fn submit_core(
    app: web::Data<App>,
    req: HttpRequest,
    form: MultipartForm<SubmitForm>,
    signed: Signed,
) -> Result<HttpResponse, DomainError> {
    let started = Instant::now();
    let function = signed.user.call.function.clone();
    let requests = UserRequests::decode(&signed.user.ctx)
        .map_err(|_| DomainError::BadRequest("invalid user requests".to_string()))?;
    let country = requests.geo.then_some(
        client_ip(&req)
            .and_then(|ip| app.geo.country(ip))
            .unwrap_or(0),
    );
    let trip = match (&form.trip, requests.trip) {
        (Some(raw), true) => Some(app.trips.compute(&raw.0)?),
        (None, false) => None,
        (Some(_), false) => {
            return Err(DomainError::BadRequest(
                "tripcode password without a tripcode request".to_string(),
            ))
        }
        (None, true) => {
            return Err(DomainError::BadRequest(
                "tripcode requested without a password".to_string(),
            ))
        }
    };
    let content = submit_content(&app, &form, &signed, requests).await;
    let content_ms = started.elapsed().as_secs_f64() * 1000.0;
    if let Err(error) = content {
        tracing::warn!(%error, %function, content_ms, "submit content rejected");
        return Err(error);
    }
    let transaction_started = Instant::now();
    let output = app
        .forum
        .submit(signed.user, signed.decryptions, country, trip)
        .await;
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

async fn submit_content(
    app: &App,
    form: &SubmitForm,
    signed: &Signed,
    requests: UserRequests,
) -> Result<(), DomainError> {
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
            return Err(DomainError::BadRequest("unexpected content".to_string()));
        }
        for key in keys {
            if received.insert(key) {
                app.content.upload(key, part.data.clone()).await?;
            }
        }
    }
    for key in &expected.keys {
        let key = *key;
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
            return Err(DomainError::BadRequest("missing content".to_string()));
        }
    }
    if matches!(
        signed.user.call.function.as_str(),
        "thread.create" | "post.create"
    ) {
        let text = expected
            .keys
            .iter()
            .find(|key| key.kind == crate::content::Kind::Text);
        let requested = match text {
            Some(key) => postpart::requests_postcount(&app.content.get(*key).await?)?,
            None => false,
        };
        if requested != requests.postcount {
            return Err(DomainError::BadRequest(
                "postcount request does not match the post text".to_string(),
            ));
        }
    }
    Ok(())
}

async fn query_user(app: web::Data<App>, body: web::Bytes) -> Result<HttpResponse, DomainError> {
    let batch: Vec<Signed> = from_bytes(&body)?;
    for signed in &batch {
        require_user(signed)?;
    }
    query_core(app, batch).await
}

async fn query_admin(app: web::Data<App>, body: web::Bytes) -> Result<HttpResponse, DomainError> {
    let batch: Vec<Signed> = from_bytes(&body)?;
    query_core(app, batch).await
}

#[tracing::instrument(target = "latency", level = "debug", name = "query.batch", skip_all,
    fields(queries = tracing::field::Empty))]
async fn query_core(app: web::Data<App>, batch: Vec<Signed>) -> Result<HttpResponse, DomainError> {
    let _handler = Timer::new("board_handler");
    let started = Instant::now();
    tracing::Span::current().record("queries", batch.len());
    let batch_wait = Timer::new("board_batch");
    let results: Vec<Vec<u8>> = stream::iter(batch.into_iter().enumerate())
        .map(|(index, signed)| {
            let app = &app;
            async move {
                let offset = started.elapsed().as_secs_f64() * 1000.0;
                let function: String = signed
                    .user
                    .call
                    .function
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                    .take(64)
                    .collect();
                let (result, timings) = timing::collect(query_page(app, signed)).await;
                timing::extra(format!(
                    "q{index}_start;dur={offset:.3};desc=\"start offset: {function}\""
                ));
                for metric in timings.header().split(", ") {
                    timing::extra(format!("q{index}_{metric}"));
                }
                result
            }
        })
        .buffered(QUERY_CONCURRENCY)
        .try_collect()
        .await?;
    drop(batch_wait);
    let _encode = Timer::new("board_encode");
    let body = tracing::debug_span!(target: "latency", "query.encode_batch")
        .in_scope(|| to_bytes(&results))?;
    Ok(HttpResponse::Ok().content_type(CONTENT_TYPE).body(body))
}

#[tracing::instrument(target = "latency", level = "debug", name = "query.page", skip_all,
    fields(root = %app.forum.root(), function = %signed.user.call.function))]
async fn query_page(app: &App, signed: Signed) -> Result<Vec<u8>, DomainError> {
    let _page = Timer::new("page");
    let function = signed.user.call.function.clone();
    let output = app
        .forum
        .query(signed.user, signed.decryptions)
        .await
        .inspect_err(|error| tracing::warn!(%error, %function, "query rejected"))?;
    hydrate(app, &function, output.result)
        .await
        .inspect_err(|error| tracing::warn!(%error, %function, "query resources failed"))
}

#[tracing::instrument(target = "latency", level = "debug", name = "query.hydrate", skip_all)]
async fn hydrate(app: &App, function: &str, result: Vec<u8>) -> Result<Vec<u8>, DomainError> {
    let _hydrate = Timer::new("hydrate");
    match function {
        "forum.meta" => view::<Entity<Forum>>(app, &result).await,
        "board.meta" => view::<Entity<Board>>(app, &result).await,
        "thread.meta" => view::<ThreadMeta>(app, &result).await,
        "forum.page" => view::<ForumPage>(app, &result).await,
        "board.page" | "board.by_id" => view::<BoardPage>(app, &result).await,
        "thread.page" | "thread.by_number" | "thread.by_id" => {
            view::<ThreadPage>(app, &result).await
        }
        "post.get" => view::<PostPage>(app, &result).await,
        _ => Ok(result),
    }
}

async fn view<T>(app: &App, result: &[u8]) -> Result<Vec<u8>, DomainError>
where
    T: PageResources + serde::de::DeserializeOwned + Serialize,
{
    let decode = Timer::new("page_decode");
    let view: T =
        tracing::debug_span!(target: "latency", "query.decode_page", bytes = result.len())
            .in_scope(|| from_bytes(result))?;
    drop(decode);
    let load = Timer::new("resources");
    let resources = WithResources::load(&app.content, view)
        .instrument(tracing::debug_span!(target: "latency", "query.resources"))
        .await?;
    drop(load);
    let _encode = Timer::new("page_encode");
    Ok(tracing::debug_span!(target: "latency", "query.encode_page")
        .in_scope(|| to_bytes(&resources))?)
}

async fn debug_entity(
    app: web::Data<App>,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, DomainError> {
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
    path: web::Path<(String, String)>,
    query: web::Query<History>,
) -> Result<HttpResponse, DomainError> {
    if query.limit == 0 || query.limit > HISTORY_LIMIT {
        return Err(DomainError::BadRequest(format!(
            "limit must be between 1 and {HISTORY_LIMIT}"
        )));
    }
    let (namespace, id) = path.into_inner();
    let id = parse_public(&id)?;
    let result = app
        .forum
        .call(
            "debug.history",
            to_bytes(&(namespace, id, query.before, query.limit))?,
        )
        .await?;
    Ok(encoded(&result))
}

async fn author_history(
    app: web::Data<App>,
    path: web::Path<String>,
    query: web::Query<AuthorHistory>,
) -> Result<HttpResponse, DomainError> {
    if query.limit == 0 || query.limit >= HISTORY_LIMIT {
        return Err(DomainError::BadRequest(format!(
            "limit must be between 1 and {}",
            HISTORY_LIMIT - 1
        )));
    }
    let esid = parse_esid(&path)?;
    let from = query.from.as_deref().map(str::parse::<Txid>).transpose()?;
    let page = app.forum.author_history(&esid, from, query.limit).await?;
    Ok(encoded(&to_bytes(&page)?))
}

fn client_ip(req: &HttpRequest) -> Option<IpAddr> {
    req.connection_info()
        .realip_remote_addr()
        .and_then(|value| value.parse().ok())
}

fn parse_public(text: &str) -> Result<[u8; 32], DomainError> {
    let text = text.strip_prefix("0x").unwrap_or(text);
    let bytes = hex::decode(text).map_err(|_| DomainError::BadRequest("key hex".to_string()))?;
    bytes
        .try_into()
        .map_err(|_| DomainError::BadRequest("key length".to_string()))
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
        .app_data(web::PayloadConfig::new(BODY_LIMIT))
        .route("/api/submit", web::post().to(submit_admin))
        .route("/api/query", web::post().to(query_admin))
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
) -> Result<web::Json<serde_json::Value>, DomainError> {
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
) -> Result<web::Json<serde_json::Value>, DomainError> {
    Ok(web::Json(moderators_json(&app.forum.moderators().await?)))
}

async fn admin_add_moderator(
    app: web::Data<App>,
    body: web::Json<ModeratorBody>,
) -> Result<web::Json<serde_json::Value>, DomainError> {
    let esid = parse_esid(&body.esid)?;
    Ok(web::Json(moderators_json(
        &app.forum.add_moderator(esid).await?,
    )))
}

async fn admin_remove_moderator(
    app: web::Data<App>,
    esid: web::Path<String>,
) -> Result<web::Json<serde_json::Value>, DomainError> {
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

fn parse_esid(text: &str) -> Result<Esid, DomainError> {
    let bytes = hex::decode(text.strip_prefix("0x").unwrap_or(text))
        .map_err(|_| DomainError::BadRequest("esid hex".to_string()))?;
    from_bytes(&bytes).map_err(|_| DomainError::BadRequest("esid encoding".to_string()))
}
