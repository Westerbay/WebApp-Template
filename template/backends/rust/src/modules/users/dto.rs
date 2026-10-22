use crate::contracts::identity::CurrentUser;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct UsersQuery {
    #[param(minimum = 1, maximum = 100, default = 20)]
    pub(crate) limit: Option<u16>,
    #[param(min_length = 1, max_length = 256)]
    pub(crate) cursor: Option<String>,
    #[param(max_length = 100)]
    pub(crate) search: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsersPage {
    pub(crate) items: Vec<CurrentUser>,
    #[schema(required = true)]
    pub(crate) next_cursor: Option<String>,
}
