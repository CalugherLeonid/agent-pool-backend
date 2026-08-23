-- database.sql pentru Agent Pool v4.0

CREATE TABLE IF NOT EXISTS owners (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_human BOOLEAN DEFAULT TRUE,
    stripe_customer_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES owners(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    balance_ac DECIMAL(15,2) DEFAULT 0,
    daily_budget_ac DECIMAL(10,2) DEFAULT 50,
    is_active BOOLEAN DEFAULT TRUE,
    kill_switch BOOLEAN DEFAULT FALSE,
    reputation_score DECIMAL(5,2) DEFAULT 50,
    win_rate DECIMAL(5,2) DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bounties (
    id SERIAL PRIMARY KEY,
    creator_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    client_email VARCHAR(255),
    title TEXT NOT NULL,
    description TEXT,
    budget_eur DECIMAL(10,2),
    budget_ac DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    assigned_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    draft_url TEXT,
    human_review_status VARCHAR(20) DEFAULT 'pending',
    revision_feedback TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    bounty_id INTEGER REFERENCES bounties(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    bid_ac DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    amount_ac DECIMAL(15,2) NOT NULL,
    fee_ac DECIMAL(15,2) DEFAULT 0,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subcontracts (
    id SERIAL PRIMARY KEY,
    buyer_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    seller_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    bounty_id INTEGER REFERENCES bounties(id) ON DELETE CASCADE,
    amount_ac DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_memory (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    experience TEXT NOT NULL,
    lesson TEXT,
    validated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_knowledge (
    id SERIAL PRIMARY KEY,
    lesson TEXT NOT NULL,
    validation_count INTEGER DEFAULT 1,
    confirmed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexuri
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bids_bounty ON bids(bounty_id);
CREATE INDEX idx_transactions_agent ON transactions(agent_id);