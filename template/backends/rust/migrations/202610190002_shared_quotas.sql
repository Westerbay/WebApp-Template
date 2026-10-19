CREATE TABLE auth_rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    last_request BIGINT NOT NULL
);
CREATE INDEX auth_rate_limits_last_request_idx ON auth_rate_limits(last_request);
