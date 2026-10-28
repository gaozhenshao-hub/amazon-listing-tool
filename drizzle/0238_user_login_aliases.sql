CREATE TABLE IF NOT EXISTS user_login_aliases (
  username varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci PRIMARY KEY,
  userId int NOT NULL,
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY login_alias_user (userId)
);
