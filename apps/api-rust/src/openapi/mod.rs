use axum::{Json, Router, routing::get};
use utoipa::OpenApi;

#[derive(OpenApi)]
struct ApiDocument;

/// Typed application API. Better Auth's route inventory has no DTO schemas at
/// the pinned revision, so it cannot replace the auth SDK's types yet.
pub fn document() -> utoipa::openapi::OpenApi {
    let mut document = ApiDocument::openapi();
    document.merge(crate::modules::identity::ApiDocument::openapi());
    document.merge(crate::modules::users::ApiDocument::openapi());
    document
}

pub(crate) fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new().route("/openapi.json", get(|| async { Json(document()) }))
}
