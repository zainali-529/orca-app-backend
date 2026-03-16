# Energy Broker Backend — Auth Module

## Stack
- Node.js + Express
- MongoDB + Mongoose
- JWT (Access + Refresh Token rotation)
- Zod validation
- Bcrypt password hashing

---

## Project Structure

```
src/
├── config/
│   └── db.js                  # MongoDB connection
├── models/
│   ├── User.js                # User schema
│   └── RefreshToken.js        # Token store + TTL auto-delete
├── services/
│   └── auth.service.js        # All business logic
├── controllers/
│   └── auth.controller.js     # HTTP layer — thin
├── routes/
│   └── auth.routes.js         # Route definitions
├── middleware/
│   ├── auth.js                # protect() — JWT guard
│   └── validate.js            # Zod schema middleware
├── validators/
│   └── auth.validators.js     # Zod schemas
├── utils/
│   ├── jwt.js                 # Token sign/verify helpers
│   └── response.js            # sendSuccess / sendError
├── __tests__/
│   └── auth.test.js           # Integration tests
├── app.js                     # Express app + middleware
└── server.js                  # Entry point
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
```bash
cp .env.example .env
```
Fill in your `.env`:
```
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb+srv://...
JWT_ACCESS_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_REFRESH_SECRET=<run same command again for a different secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

### 3. Run development server
```bash
npm run dev
```

### 4. Run tests
```bash
# Add MONGO_TEST_URI to .env first (separate test DB)
npm test
```

---

## API Endpoints

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/health` | No | Server health check |
| POST | `/api/auth/register` | No | Create new account |
| POST | `/api/auth/login` | No | Login, get tokens |
| POST | `/api/auth/refresh` | No | Rotate refresh token |
| POST | `/api/auth/logout` | No | Revoke refresh token |
| GET | `/api/auth/me` | Yes (Bearer) | Get current user |
| POST | `/api/auth/logout-all` | Yes (Bearer) | Revoke all devices |

---

## Request / Response Examples

### Register
```
POST /api/auth/register
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john@example.com",
  "phone": "07911123456",      ← optional
  "password": "Test1234"       ← min 8 chars, 1 upper, 1 lower, 1 number
}

Response 201:
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": { "id", "firstName", "lastName", "email", "phone", "createdAt" }
  }
}
```

### Login
```
POST /api/auth/login
{ "email": "john@example.com", "password": "Test1234" }

Response 200:
{
  "success": true,
  "data": {
    "user": { ... },
    "accessToken": "eyJ...",     ← expires in 15 min
    "refreshToken": "eyJ..."     ← expires in 7 days, store securely
  }
}
```

### Protected route
```
GET /api/auth/me
Authorization: Bearer <accessToken>
```

### Refresh
```
POST /api/auth/refresh
{ "refreshToken": "eyJ..." }

→ Returns new accessToken + new refreshToken (old one is revoked)
```

---

## Security Notes

- Passwords hashed with bcrypt (cost factor 12)
- Access tokens expire in 15 minutes
- Refresh tokens rotate on every use — old token immediately revoked
- Expired refresh tokens auto-deleted from DB via MongoDB TTL index
- Rate limiter: 10 requests / 15 min on auth routes
- Helmet sets security headers
- Request body limited to 10kb to prevent payload attacks

---

## Postman

Import `Energy-Broker-Auth.postman_collection.json`  
Run Register → Login (auto-saves tokens) → all other requests work automatically.
