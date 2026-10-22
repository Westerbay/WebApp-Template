//! SQLx embeds immutable SQL, validates checksums, and locks concurrent migrators.
use better_auth::seaorm::DatabaseConnection;
use sqlx::{PgPool, migrate::Migrator};

pub static MIGRATIONS: Migrator = sqlx::migrate!("./migrations");

pub async fn apply(database: &DatabaseConnection) -> Result<(), sqlx::migrate::MigrateError> {
    let pool = database.get_postgres_connection_pool();
    let untracked: bool = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NULL AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema())").fetch_one(pool).await?;
    if untracked {
        return Err(sqlx::Error::Protocol(
            "Refusing a non-empty schema without this application's migration history".into(),
        )
        .into());
    }
    MIGRATIONS.run(pool).await
}

/// Read-only startup check: serving requests never applies DDL or creates history.
pub async fn check(pool: &PgPool) -> Result<(), &'static str> {
    let present: bool = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
        .fetch_one(pool)
        .await
        .map_err(|_| "MIGRATION_CHECK_FAILED")?;
    if !present {
        return Err("MIGRATIONS_PENDING");
    }
    let applied: Vec<(i64, Vec<u8>, bool)> =
        sqlx::query_as("SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await
            .map_err(|_| "MIGRATION_CHECK_FAILED")?;
    for (version, checksum, success) in &applied {
        let Some(expected) = MIGRATIONS.iter().find(|entry| entry.version == *version) else {
            return Err("MIGRATION_HISTORY_UNKNOWN");
        };
        if !success || checksum.as_slice() != expected.checksum.as_ref() {
            return Err("MIGRATION_HISTORY_MISMATCH");
        }
    }
    if applied.len() != MIGRATIONS.iter().count() {
        return Err("MIGRATIONS_PENDING");
    }
    Ok(())
}
