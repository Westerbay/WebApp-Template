use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(crate::modules::identity::me, crate::modules::users::list),
    components(schemas(
        crate::contracts::identity::CurrentUser,
        crate::modules::users::dto::UsersPage
    ))
)]
struct ApiDocument;

/// Typed application API. Better Auth's route inventory has no DTO schemas at
/// the pinned revision, so it cannot replace the auth SDK's types yet.
pub fn document() -> utoipa::openapi::OpenApi {
    ApiDocument::openapi()
}
