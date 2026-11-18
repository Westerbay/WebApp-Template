use super::*;

#[tokio::test]
async fn application_openapi_describes_the_actual_identity_response() {
    let app = fixture(settings::local()).await;
    let (status, _, document) = call(&app, "/openapi.json", None, "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        document["paths"]["/api/me"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
            ["$ref"],
        "#/components/schemas/CurrentUser"
    );
    let properties = &document["components"]["schemas"]["CurrentUser"]["properties"];
    assert_eq!(properties["emailVerified"]["type"], "boolean");
    assert_eq!(properties.as_object().unwrap().len(), 4);
}

#[tokio::test]
async fn existing_frontend_users_contract_keeps_pagination_search_and_access_checks() {
    use better_auth::prelude::CreateUser;
    let app = fixture(settings::local()).await;
    assert_eq!(
        call(&app, "/api/users", None, "").await.0,
        StatusCode::UNAUTHORIZED
    );
    signup(&app, PASSWORD).await;
    verify(&app).await;
    let (cookie, _) = login(&app, PASSWORD).await;
    for (email, name) in [
        ("percent@example.test", "Literal%Name"),
        ("underscore@example.test", "Literal_Name"),
        ("mixed@example.test", "MiXeD"),
    ] {
        app.auth
            .store()
            .create_user(CreateUser::new().with_email(email).with_name(name))
            .await
            .unwrap();
    }
    let (status, _, body) = call(&app, "/api/users?limit=1", None, &cookie).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
    let cursor = body["nextCursor"].as_str().unwrap();
    let next = call(
        &app,
        &format!("/api/users?limit=1&cursor={cursor}"),
        None,
        &cookie,
    )
    .await
    .2;
    assert_ne!(body["items"][0]["id"], next["items"][0]["id"]);
    for (search, name) in [
        ("%25", "Literal%Name"),
        ("_", "Literal_Name"),
        ("mixed", "MiXeD"),
    ] {
        let (status, _, body) =
            call(&app, &format!("/api/users?search={search}"), None, &cookie).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["items"].as_array().unwrap().len(), 1);
        assert_eq!(body["items"][0]["name"], name);
        assert!(body["nextCursor"].is_null());
    }
    assert_eq!(
        call(&app, "/api/users?limit=101", None, &cookie).await.0,
        StatusCode::BAD_REQUEST
    );
}
