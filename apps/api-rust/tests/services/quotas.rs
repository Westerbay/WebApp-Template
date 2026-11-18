use super::*;

#[tokio::test]
async fn quota_admission_is_shared_between_replicas_and_denials_do_not_extend_the_window() {
    let config = settings::local();
    let first = support::fixture(config.clone()).await;
    let second = Application::connect(
        config,
        first.database.clone(),
        AuthServices::configured(Mailbox::default()).unwrap(),
    )
    .await
    .unwrap();
    let mut tasks = Vec::new();
    for index in 0..12 {
        let router = if index % 2 == 0 {
            first.router.clone()
        } else {
            second.router.clone()
        };
        tasks.push(tokio::spawn(async move {
            router
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/auth/send-verification-email")
                        .header("origin", settings::WEB_ORIGIN)
                        .header("content-type", "application/json")
                        .header("x-forwarded-for", format!("192.0.2.{index}"))
                        .extension(axum::extract::ConnectInfo(
                            "127.0.0.1:12345".parse::<std::net::SocketAddr>().unwrap(),
                        ))
                        .body(Body::from(r#"{"email":"unknown@example.test"}"#))
                        .unwrap(),
                )
                .await
                .unwrap()
                .status()
        }));
    }
    let mut allowed = 0;
    for task in tasks {
        let status = task.await.unwrap();
        if status == StatusCode::OK {
            allowed += 1;
        } else {
            assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        }
    }
    assert_eq!(allowed, 5);
    let quotas = SharedQuotas(first.database.clone());
    assert_eq!(quotas.consume("window-test", 1, 60).await.unwrap(), None);
    let backend = first.database.get_database_backend();
    let before = first
        .database
        .query_one_raw(Statement::from_sql_and_values(
            backend,
            "SELECT last_request FROM auth_rate_limits WHERE key=$1",
            ["window-test".into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "last_request")
        .unwrap();
    assert!(
        quotas
            .consume("window-test", 1, 60)
            .await
            .unwrap()
            .is_some()
    );
    let after = first
        .database
        .query_one_raw(Statement::from_sql_and_values(
            backend,
            "SELECT last_request FROM auth_rate_limits WHERE key=$1",
            ["window-test".into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "last_request")
        .unwrap();
    assert_eq!(before, after);
    first
        .database
        .execute_raw(Statement::from_sql_and_values(
            backend,
            "UPDATE auth_rate_limits SET last_request=$1 WHERE key=$2",
            [(before - 60_000).into(), "window-test".into()],
        ))
        .await
        .unwrap();
    assert_eq!(quotas.consume("window-test", 1, 60).await.unwrap(), None);
}

#[tokio::test]
async fn unavailable_shared_quotas_reject_auth_and_private_identity() {
    let app = support::fixture(settings::local()).await;
    app.database
        .execute_unprepared("DROP TABLE auth_rate_limits")
        .await
        .unwrap();
    assert_eq!(
        signup(&app, "alice@example.test", PASSWORD).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        call(&app, "/api/me", None, "").await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn private_identity_and_general_auth_keep_their_distinct_shared_quotas() {
    let app = support::fixture(settings::local()).await;
    for _ in 0..30 {
        assert_eq!(
            call(&app, "/api/me", None, "").await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    let (status, headers, _) = call(&app, "/api/me", None, "").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(
        headers["retry-after"]
            .to_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            > 0
    );
    for _ in 0..100 {
        assert_eq!(
            call(&app, "/api/auth/get-session", None, "").await.0,
            StatusCode::OK
        );
    }
    assert_eq!(
        call(&app, "/api/auth/get-session", None, "").await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
}
