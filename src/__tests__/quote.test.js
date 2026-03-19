require('dotenv').config();

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../app');
const User     = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const Quote    = require('../models/Quote');
const Tariff   = require('../models/Tariff');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || process.env.MONGO_URI?.replace('energy-broker', 'energy-broker-test');

// ── Test data ──────────────────────────────────────────────────
const brokerData = {
  firstName: 'Sarah',
  lastName:  'Jones',
  email:     'sarah@broker.com',
  password:  'Test1234',
};

const sampleTariff = {
  supplier:    'So Energy',
  supplierRating: 4.5,
  tariffName:  'So Fixed 12M Green',
  tariffCode:  'SOE-GRN12-TEST',
  fuelType:    'dual',
  tariffType:  'fixed',
  region:      'national',
  electricity: { unitRate: 22.90, standingCharge: 50.50 },
  gas:         { unitRate: 5.95,  standingCharge: 27.00 },
  contractLengthMonths: 12,
  exitFee:     0,
  isGreen:     true,
  cashback:    50,
  features:    ['100% renewable', '£50 cashback'],
  source:      'seed',
  isActive:    true,
};

const clientData = {
  name:    'John Smith',
  company: 'Smith & Sons Ltd',
  email:   'john@smithsons.co.uk',
  phone:   '07911123456',
  mpan:    '1900012345678',
  mprn:    '1234567',
};

let accessToken;
let tariffId;
let quoteId;

// ── Setup ──────────────────────────────────────────────────────
beforeAll(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  await Promise.all([
    User.deleteMany({}),
    Quote.deleteMany({}),
    Tariff.deleteMany({ tariffCode: sampleTariff.tariffCode }),
  ]);

  // Register + login broker
  await request(app).post('/api/auth/register').send(brokerData);
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: brokerData.email, password: brokerData.password });
  accessToken = loginRes.body.data.accessToken;

  // Create test tariff
  const tariff = await Tariff.create(sampleTariff);
  tariffId = tariff._id.toString();
});

afterAll(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    Quote.deleteMany({}),
    Tariff.deleteMany({ tariffCode: sampleTariff.tariffCode }),
  ]);
  await mongoose.connection.close();
});

// ── CREATE ─────────────────────────────────────────────────────
describe('POST /api/quotes', () => {
  it('should create a quote with full data', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        client:                   clientData,
        tariffId,
        annualElectricityKwh:     3200,
        annualGasKwh:             12000,
        currentSupplierAnnualCost: 1500,
        notes:                    'Client wants to switch ASAP',
        validDays:                30,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quote).toMatchObject({
      status:      'draft',
      quoteNumber: expect.stringMatching(/^EB-\d{4}-\d{6}$/),
    });
    expect(res.body.data.quote.tariff.supplier).toBe('So Energy');
    expect(res.body.data.quote.pricing.totalAnnualCost).toBeGreaterThan(0);
    expect(res.body.data.quote.pricing.annualSaving).toBeGreaterThan(0);

    quoteId = res.body.data.quote._id;
  });

  it('should create a minimal quote (no usage data)', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        client:   { name: 'Minimal Client' },
        tariffId,
        annualElectricityKwh: 2900,
        annualGasKwh:         11500,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.quote.client.name).toBe('Minimal Client');
  });

  it('should fail without a tariff ID', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ client: clientData });

    expect(res.statusCode).toBe(422);
    expect(res.body.errors).toHaveProperty('tariffId');
  });

  it('should fail without client name', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ client: { email: 'no-name@test.com' }, tariffId });

    expect(res.statusCode).toBe(422);
  });

  it('should fail with invalid tariff ID', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        client:               { name: 'Test' },
        tariffId:             '000000000000000000000000', // valid format, non-existent
        annualElectricityKwh: 2900,
        annualGasKwh:         11500,
      });

    expect(res.statusCode).toBe(404);
  });

  it('should fail without auth token', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .send({ client: clientData, tariffId });

    expect(res.statusCode).toBe(401);
  });
});

// ── LIST ───────────────────────────────────────────────────────
describe('GET /api/quotes', () => {
  it('should list all my quotes', async () => {
    const res = await request(app)
      .get('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.quotes)).toBe(true);
    expect(res.body.data.quotes.length).toBeGreaterThan(0);
    expect(res.body.data.pagination).toHaveProperty('total');
  });

  it('should filter by status=draft', async () => {
    const res = await request(app)
      .get('/api/quotes?status=draft')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    res.body.data.quotes.forEach((q) => {
      expect(q.status).toBe('draft');
    });
  });
});

// ── GET SINGLE ─────────────────────────────────────────────────
describe('GET /api/quotes/:id', () => {
  it('should fetch a quote by ID', async () => {
    const res = await request(app)
      .get(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.quote._id).toBe(quoteId);
    expect(res.body.data.quote.client.name).toBe(clientData.name);
  });

  it('should return 404 for non-existent quote', async () => {
    const res = await request(app)
      .get('/api/quotes/000000000000000000000000')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(404);
  });
});

// ── STATS ─────────────────────────────────────────────────────
describe('GET /api/quotes/stats', () => {
  it('should return quote stats', async () => {
    const res = await request(app)
      .get('/api/quotes/stats')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.stats).toHaveProperty('draft');
    expect(res.body.data.stats).toHaveProperty('sent');
    expect(res.body.data.stats).toHaveProperty('accepted');
    expect(res.body.data.stats.draft).toBeGreaterThan(0);
  });
});

// ── UPDATE ─────────────────────────────────────────────────────
describe('PATCH /api/quotes/:id', () => {
  it('should update notes', async () => {
    const res = await request(app)
      .patch(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notes: 'Updated notes — client confirmed interest' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.quote.notes).toBe('Updated notes — client confirmed interest');
  });

  it('should transition status from draft to sent', async () => {
    const res = await request(app)
      .patch(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'sent' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.quote.status).toBe('sent');
  });

  it('should reject invalid status transition (draft → accepted)', async () => {
    // Create fresh draft quote
    const createRes = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        client:               { name: 'Status Test Client' },
        tariffId,
        annualElectricityKwh: 2900,
        annualGasKwh:         11500,
      });
    const newId = createRes.body.data.quote._id;

    const res = await request(app)
      .patch(`/api/quotes/${newId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'accepted' }); // draft → accepted NOT allowed

    expect(res.statusCode).toBe(400);
  });

  it('should update client details', async () => {
    const res = await request(app)
      .patch(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ client: { phone: '07999888777' } });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.quote.client.phone).toBe('07999888777');
  });
});

// ── PDF GENERATION ─────────────────────────────────────────────
describe('POST /api/quotes/:id/pdf', () => {
  it('should generate a PDF (stream or Cloudinary URL)', async () => {
    const res = await request(app)
      .post(`/api/quotes/${quoteId}/pdf`)
      .set('Authorization', `Bearer ${accessToken}`);

    // Could be 200 (Cloudinary URL) or PDF stream (binary)
    const isJson   = res.headers['content-type']?.includes('application/json');
    const isPdf    = res.headers['content-type']?.includes('application/pdf');

    expect([200]).toContain(res.statusCode);

    if (isJson) {
      // Cloudinary configured
      expect(res.body.data).toHaveProperty('pdfUrl');
    } else if (isPdf) {
      // Dev mode — direct stream
      expect(res.body).toBeDefined();
    }
  }, 20000); // 20s timeout for PDF generation
});

// ── DELETE ─────────────────────────────────────────────────────
describe('DELETE /api/quotes/:id', () => {
  it('should delete a quote', async () => {
    // Create a quote to delete
    const createRes = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        client:               { name: 'Delete Me' },
        tariffId,
        annualElectricityKwh: 2900,
        annualGasKwh:         11500,
      });
    const delId = createRes.body.data.quote._id;

    const delRes = await request(app)
      .delete(`/api/quotes/${delId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(delRes.statusCode).toBe(200);

    // Verify deleted
    const getRes = await request(app)
      .get(`/api/quotes/${delId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(getRes.statusCode).toBe(404);
  });
});
