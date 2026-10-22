use webapp_api::{config::auth as settings, infrastructure::database::migrations};
mod support;

#[tokio::test]
async fn non_empty_untracked_schema_is_refused_without_creating_a_ledger() {
    let app = support::fixture(settings::local()).await;
    let pool = app.database.get_postgres_connection_pool();
    sqlx::query("DROP TABLE _sqlx_migrations")
        .execute(pool)
        .await
        .unwrap();
    assert!(migrations::apply(&app.database).await.is_err());
    let ledger: bool = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!ledger);
}

#[tokio::test]
async fn repeated_concurrent_migration_preserves_users_and_checks_history() {
    let app = support::fixture(settings::local()).await;
    let user = app
        .auth
        .store()
        .create_user(better_auth::prelude::CreateUser::new().with_email("migration@example.test"))
        .await
        .unwrap();
    let pool = app.database.get_postgres_connection_pool();
    let (first, second) = tokio::join!(
        migrations::apply(&app.database),
        migrations::apply(&app.database)
    );
    first.unwrap();
    second.unwrap();
    migrations::check(pool).await.unwrap();
    let versions: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(versions, vec![202610190001]);
    assert_eq!(
        app.auth
            .store()
            .get_user_by_email("migration@example.test")
            .await
            .unwrap()
            .unwrap()
            .id,
        user.id
    );
    sqlx::query(
        "UPDATE _sqlx_migrations SET checksum = decode('00', 'hex') WHERE version = 202610190001",
    )
    .execute(pool)
    .await
    .unwrap();
    assert_eq!(
        migrations::check(pool).await,
        Err("MIGRATION_HISTORY_MISMATCH")
    );
    assert!(migrations::apply(&app.database).await.is_err());
}

#[tokio::test]
async fn failed_migration_rolls_back_ddl_and_preserves_the_previous_version() {
    let app = support::fixture(settings::local()).await;
    let directory =
        std::env::temp_dir().join(format!("rust-migrations-{:x}", rand::random::<u64>()));
    std::fs::create_dir(&directory).unwrap();
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
        let entry = entry.unwrap();
        std::fs::copy(entry.path(), directory.join(entry.file_name())).unwrap();
    }
    std::fs::write(
        directory.join("209901010001_broken.sql"),
        "CREATE TABLE should_roll_back(id TEXT); SELECT * FROM missing_fixture_table;",
    )
    .unwrap();
    let changed = sqlx::migrate::Migrator::new(directory.as_path())
        .await
        .unwrap();
    let result = changed
        .run(app.database.get_postgres_connection_pool())
        .await;
    std::fs::remove_dir_all(directory).unwrap();
    assert!(result.is_err());
    let exists: bool = sqlx::query_scalar("SELECT to_regclass('should_roll_back') IS NOT NULL")
        .fetch_one(app.database.get_postgres_connection_pool())
        .await
        .unwrap();
    assert!(!exists);
    migrations::check(app.database.get_postgres_connection_pool())
        .await
        .unwrap();
}
