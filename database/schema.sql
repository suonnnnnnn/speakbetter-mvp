-- SpeakBetter MVP 数据库 Schema（PostgreSQL）

create table if not exists users (
  id varchar(64) primary key,
  email varchar(255) unique,
  mobile varchar(32),
  nickname varchar(64) not null,
  avatar text,
  created_at timestamptz not null default now()
);

create table if not exists topics (
  id bigserial primary key,
  title varchar(255) not null,
  content text not null,
  topic_type varchar(32) not null,
  difficulty varchar(32) not null,
  target_skill varchar(32) not null,
  suggested_framework varchar(64),
  recommended_duration varchar(16),
  training_goal text,
  created_at timestamptz not null default now()
);

create table if not exists training_sessions (
  id uuid primary key,
  user_id varchar(64) not null references users(id),
  mode_type varchar(32) not null,
  duration_type varchar(16) not null,
  topic_id bigint references topics(id),
  topic_snapshot jsonb not null,
  audio_url text,
  transcript_text text,
  speech_features jsonb,
  status varchar(32) not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists evaluation_reports (
  id bigserial primary key,
  session_id uuid not null unique references training_sessions(id),
  overall_score int not null,
  logic_score int not null,
  structure_score int not null,
  brevity_score int not null,
  precision_score int not null,
  speaking_score int not null,
  effectiveness_score int not null,
  appropriateness_score int not null,
  issue_tags jsonb not null,
  detected_issues jsonb not null,
  strengths jsonb not null,
  suggestions jsonb not null,
  thinking_guide jsonb not null,
  rewrites jsonb not null,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists debate_rounds (
  id bigserial primary key,
  session_id uuid not null references training_sessions(id),
  round_index int not null,
  speaker_type varchar(16) not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists roleplay_scenarios (
  id bigserial primary key,
  scenario_name varchar(128) not null,
  relationship_type varchar(64) not null,
  description text not null,
  ai_role_prompt text not null,
  difficulty varchar(32) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_training_sessions_user_created
on training_sessions(user_id, created_at desc);
