mod command;
mod health;
mod migrations;

use command::Command;

pub async fn run() -> Result<(), &'static str> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = Command::parse(&args)?;
    let get = |name: &str| std::env::var(name).ok();
    if !matches!(command, Command::OpenApi | Command::HealthCheck) {
        crate::infrastructure::http::logging::init_logs()?;
    }
    match command {
        Command::OpenApi => export_openapi(),
        Command::HealthCheck => health::check(&get).await,
        Command::Migrate { target } => migrations::apply(&get, target.as_deref()).await,
        Command::CheckMigrations => migrations::check(&get).await,
        Command::Serve => crate::server::run(&get).await,
        Command::TestServer => crate::server::run_fixture().await,
    }
}

fn export_openapi() -> Result<(), &'static str> {
    let document = crate::openapi::document()
        .to_pretty_json()
        .map_err(|_| "OPENAPI_FAILED")?;
    println!("{document}");
    Ok(())
}
