use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(crate::me, crate::users::list),
    components(schemas(crate::CurrentUser, crate::users::UsersPage))
)]
struct ApiDocument;

/// Typed application API. Better Auth's route inventory has no DTO schemas at
/// the pinned revision, so it cannot replace the auth SDK's types yet.
pub fn document() -> utoipa::openapi::OpenApi {
    ApiDocument::openapi()
}
