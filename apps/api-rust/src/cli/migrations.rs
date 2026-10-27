use crate::{config::runtime::DatabaseSettings, infrastructure::database::migrations};

pub(super) async fn apply(
    get: &impl Fn(&str) -> Option<String>,
    target: Option<&str>,
) -> Result<(), &'static str> {
    let config = DatabaseSettings::from_values(get)?;
    config.authorize_migration(target, get("DATABASE_FIXTURE_MODE").as_deref())?;
    execute(config, true).await
}

pub(super) async fn check(get: &impl Fn(&str) -> Option<String>) -> Result<(), &'static str> {
    execute(DatabaseSettings::from_values(get)?, false).await
}

async fn execute(config: DatabaseSettings, apply: bool) -> Result<(), &'static str> {
    let database = config.connect().await?;
    let result = if apply {
        migrations::apply(&database)
            .await
            .map_err(|_| "MIGRATION_FAILED")
    } else {
        migrations::check(database.get_postgres_connection_pool()).await
    };
    let closed = database.close().await.map_err(|_| "DATABASE_CLOSE_FAILED");
    result.and(closed)?;
    println!("Migrations verified");
    Ok(())
}
