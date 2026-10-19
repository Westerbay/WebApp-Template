use webapp_api::Application;

pub async fn fixture(config: better_auth::AuthConfig) -> Application {
    if std::env::var("RUST_AUTH_PROTOTYPE_POSTGRES").as_deref() != Ok("1") {
        return Application::with_config(config).await.unwrap();
    }
    // No caller-supplied URL, credentials, existing database or host ports.
    // This exact disposable service is created only by this prototype's Compose stack.
    use better_auth::seaorm::{
        Database,
        sea_orm::{ConnectOptions, ConnectionTrait},
    };
    use rand::Rng;
    let url = "postgres://prototype:prototype@postgres:5432/rust_auth_prototype";
    let namespace = format!("test_{:x}", rand::thread_rng().r#gen::<u64>());
    let admin = Database::connect(url).await.unwrap();
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {namespace}"))
        .await
        .unwrap();
    admin.close().await.unwrap();
    let mut options = ConnectOptions::new(url);
    options
        .set_schema_search_path(namespace)
        .sqlx_logging(false);
    let database = Database::connect(options).await.unwrap();
    Application::with_database(config, database).await.unwrap()
}
