use std::path::PathBuf;
use std::sync::Arc;

use actix_cors::Cors;
use actix_web::web;
use clap::Parser;
use tracing_subscriber::EnvFilter;

use ech_board_server::config::Config;
use ech_board_server::content::Store;
use ech_board_server::db::DbClient;
use ech_board_server::forum::Forum;
use ech_board_server::http;
use ech_board_server::realtime::{App, Hub};
use ech_db_sdk::Domain;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "config.json")]
    config: PathBuf,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
        .init();
    let args = Args::parse();
    let config = Config::load(&args.config)?;
    let domain = Domain::new(config.key()?).ok_or("domain key must not be zero")?;
    let wasm = std::fs::read(&config.program)?;
    let forum = Arc::new(Forum::new(
        DbClient::new(config.db.clone())?,
        domain,
        &wasm,
    )?);
    forum.deploy().await?;
    forum.ensure().await?;
    let hub = Arc::new(Hub::new());
    let content = Arc::new(Store::new(&config.content)?);
    hub.spawn(forum.clone(), content.clone());
    let app = Arc::new(App {
        forum,
        hub,
        content,
    });
    tracing::info!(
        root = %app.forum.root(),
        program = %app.forum.program(),
        listen = %config.listen,
        admin = %config.admin,
        "board running"
    );
    let listen = config.listen.to_string();
    let admin = config.admin.to_string();
    let admin_data = web::Data::from(app.clone());
    let admin_server = actix_web::HttpServer::new(move || {
        actix_web::App::new()
            .app_data(admin_data.clone())
            .wrap(Cors::permissive())
            .configure(http::admin_routes)
    })
    .bind(admin)?
    .run();
    let data = web::Data::from(app);
    let server = actix_web::HttpServer::new(move || {
        actix_web::App::new()
            .app_data(data.clone())
            .wrap(Cors::permissive())
            .configure(http::routes)
    })
    .bind_auto_h2c(listen)?
    .run();
    tokio::try_join!(admin_server, server)?;
    Ok(())
}
