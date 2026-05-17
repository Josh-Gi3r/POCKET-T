import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = postgres(process.env.DATABASE_URL, {
  max:             20,
  idle_timeout:    30,
  connect_timeout: 10,
  transform:       postgres.camel,  // snake_case → camelCase
});

export default sql;
