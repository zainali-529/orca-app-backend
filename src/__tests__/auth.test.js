require('dotenv').config();

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

// Use a separate test DB
const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || process.env.MONGO_URI?.replace('energy-broker', 'energy-broker-test');

beforeAll(async () => {
  await mongoose.connect(TEST_MONGO_URI);
});

afterAll(async () => {
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
  await mongoose.connection.close();
});

afterEach(async () => {
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
});

// ── Test data ──────────────────────────────────────────────
const validUser = {
  firstName: 'John',
  lastName: 'Smith',
  email: 'john@example.com',
  phone: '07911123456',
  password: 'Test1234',
};

// ── REGISTER ───────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('should register a new user successfully', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.user.password).toBeUndefined(); // password never exposed
  });

  it('should fail with duplicate email', async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should fail with invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, email: 'not-an-email' });

    expect(res.statusCode).toBe(422);
    expect(res.body.errors).toHaveProperty('email');
  });

  it('should fail with weak password (no uppercase)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, password: 'weakpassword1' });

    expect(res.statusCode).toBe(422);
    expect(res.body.errors).toHaveProperty('password');
  });

  it('should fail when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com' });

    expect(res.statusCode).toBe(422);
  });
});

// ── LOGIN ──────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
  });

  it('should login with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.user.email).toBe(validUser.email);
  });

  it('should fail with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: 'WrongPass1' });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should fail with non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: validUser.password });

    expect(res.statusCode).toBe(401);
  });

  it('should not expose password in response', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.body.data.user.password).toBeUndefined();
  });
});

// ── REFRESH TOKEN ──────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  let refreshToken;

  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    refreshToken = loginRes.body.data.refreshToken;
  });

  it('should return a new access + refresh token pair', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    // Token rotation: new refresh token should differ
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('should reject an already-used refresh token (rotation)', async () => {
    await request(app).post('/api/auth/refresh').send({ refreshToken });

    // Reuse the old token
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.statusCode).toBe(401);
  });

  it('should fail with invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'completely.invalid.token' });

    expect(res.statusCode).toBe(401);
  });

  it('should fail when refreshToken is missing', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.statusCode).toBe(422);
  });
});

// ── GET ME ─────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  let accessToken;

  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    accessToken = loginRes.body.data.accessToken;
  });

  it('should return current user with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('should fail without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toBe(401);
  });

  it('should fail with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.statusCode).toBe(401);
  });
});

// ── LOGOUT ─────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  let tokens;

  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    tokens = loginRes.body.data;
  });

  it('should logout and revoke refresh token', async () => {
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: tokens.refreshToken });

    expect(logoutRes.statusCode).toBe(200);

    // Attempt to use revoked refresh token
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(refreshRes.statusCode).toBe(401);
  });

  it('should succeed even without a refreshToken in body', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.statusCode).toBe(200);
  });
});
