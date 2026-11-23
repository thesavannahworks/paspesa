# PASPESA PRODUCTION DEPLOYMENT GUIDE (FREE TIER)

**Cost: $0/month using free tiers**  
**Timeline: 2-3 hours for initial setup**  
**Last Updated:** 2026-11-22

---

## DEPLOYMENT STACK (100% FREE)

```
┌─────────────────────────────────────────────────┐
│          PRODUCTION ARCHITECTURE                │
└─────────────────────────────────────────────────┘

Railway (FREE Trial - $5 credit)
  ├── Backend Service (NestJS)
  │   └── HTTPS: paspesa-backend.up.railway.app
  │
  └── Connects to ↓

Neon (FREE Forever - Hobby Plan)
  └── PostgreSQL Database
      ├── 512MB storage
      ├── Automatic backups
      └── 1 compute unit
```

**What We Get FREE:**
- ✅ Railway: First month free ($5 credit covers backend)
- ✅ Neon: Forever free PostgreSQL
- ✅ HTTPS included (Railway + Neon)
- ✅ Automatic deployments from GitHub
- ✅ Daily database backups (Neon)

---

## PHASE 1: NEON DATABASE SETUP (15 minutes)

### Step 1: Create Neon Account

1. Go to https://neon.tech
2. Click "Sign Up"
3. Choose **GitHub login** (easier connection to Railway)
4. Confirm email

### Step 2: Create Database

1. Click "Create Project"
2. Project name: `paspesa-production`
3. PostgreSQL version: **15** (recommended)
4. Region: Choose closest to your users (e.g., `AWS / eu-central-1 (Frankfurt)`)
5. Click "Create Project"

### Step 3: Get Connection String

1. In Neon dashboard, click your project
2. Click "Connection Details"
3. Copy the **Connection string** (looks like):
   ```
   postgresql://pascal:[password]@ep-[random].eu-central-1.aws.neon.tech/paspesa?sslmode=require
   ```
4. **SAVE THIS** - you'll need it for Railway

### Step 4: Verify Database

```bash
# Optional: Test connection locally
DATABASE_URL="postgresql://pascal:[password]@ep-[random].eu-central-1.aws.neon.tech/paspesa?sslmode=require" \
  npm run dev -w @paspesa/backend

# Should see:
# [paspesa] backend listening on http://0.0.0.0:3000 (database: PostgreSQL)
```

**Expected Result:** ✅ Fresh empty database ready

---

## PHASE 2: RAILWAY SETUP (20 minutes)

### Method A: Railway Dashboard (Recommended for first time)

**Step 1: Create Railway Account**

1. Go to https://railway.app
2. Click "Login"
3. Choose **GitHub login**
4. Authorize Railway to access your repositories

**Step 2: Create New Project**

1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose repository: `PascalTwoli/paspesa`
4. Click "Deploy Now"

**Step 3: Configure Service**

Railway will auto-detect Node.js, but we need to configure:

1. Click on the deployed service
2. Go to "Settings" tab
3. Set these values:

**Root Directory:**
```
/ 
(leave as root - monorepo detected automatically)
```

**Start Command:**
```
npm run start -w @paspesa/backend
```

**Health Check Path:**
```
/v1/health
```

**Step 4: Add Environment Variables**

Click "Variables" tab and add:

```bash
# Database (from Neon)
DATABASE_URL=postgresql://pascal:[password]@ep-[random].eu-central-1.aws.neon.tech/paspesa?sslmode=require

# App Config
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# PayHero (your rotated credentials)
PAYHERO_BASIC_TOKEN=Basic [your_new_token]
PAYHERO_CHANNEL_ID=15710
PAYHERO_CALLBACK_URL=https://paspesa-backend-production.up.railway.app/v1/payments/payhero/callback

# SMTP (your rotated Gmail password)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=thesavannahworks@gmail.com
SMTP_PASS=[your_new_app_password]
MAIL_FROM=Paspesa <thesavannahworks@gmail.com>

# Security
ADMIN_REQUIRE_2FA=false
SESSION_SECRET=[generate_random_32_chars]
```

**Generate Session Secret:**
```bash
# Run in terminal:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy output to SESSION_SECRET
```

**Step 5: Deploy**

1. Click "Deploy" or wait for auto-deploy
2. Watch logs in "Deployments" tab
3. Wait for "Deployed" status (~3-5 minutes)

**Step 6: Get Your Railway URL**

1. Go to "Settings" tab
2. Under "Domains", click "Generate Domain"
3. Railway creates: `paspesa-backend-production.up.railway.app`
4. **Copy this URL** - you'll need it

**Step 7: Verify Deployment**

```bash
# Test health check
curl https://paspesa-backend-production.up.railway.app/v1/health

# Expected response:
# {"status":"ok","database":"postgres"}
```

✅ **Backend is LIVE!**

---

### Method B: Railway CLI (Faster if you prefer terminal)

**Install Railway CLI:**
```bash
# Windows (PowerShell as Admin)
iwr https://railway.app/install.ps1 | iex

# Or download from: https://railway.app/cli
```

**Deploy Steps:**
```bash
cd C:\Users\Lenovo\Pascal\Dev\paspesa

# Login
railway login

# Create project and link
railway init
# Choose: "Create new project"
# Name: paspesa-production

# Add environment variables
railway variables set NODE_ENV=production
railway variables set PORT=3000
railway variables set DATABASE_URL="postgresql://..."
railway variables set PAYHERO_BASIC_TOKEN="Basic ..."
# ... (add all variables from Method A)

# Deploy
railway up

# Get URL
railway domain

# Check logs
railway logs
```

---

## PHASE 3: UPDATE PAYHERO CALLBACK (5 minutes)

### Step 1: Login to PayHero

1. Go to https://app.payhero.co.ke
2. Login with your credentials
3. Navigate to **API Keys** section

### Step 2: Update Callback URL

Look for "Webhook URL" or "Callback URL" setting and update to:
```
https://paspesa-backend-production.up.railway.app/v1/payments/payhero/callback
```

**Note:** Old ngrok URL will stop working - this is expected!

### Step 3: Test Payment

1. Use back office to create test admin user
2. Buy smallest token amount (KSh 1 if possible)
3. Complete M-PESA prompt on phone
4. Watch Railway logs: `railway logs --tail`
5. Verify callback received and payment completed

Expected logs:
```
[paspesa] Callback received: payhero
[paspesa] Payment verified: [payment-id]
[paspesa] Tokens credited: 1
```

✅ **PayHero connected to Railway!**

---

## PHASE 4: BUILD PRODUCTION MOBILE APP (15 minutes)

### Step 1: Update API URL

```bash
cd apps/mobile

# Set production URL
npx eas-cli env:set \
  --name EXPO_PUBLIC_PASPESA_API_URL \
  --value https://paspesa-backend-production.up.railway.app \
  --environment production \
  --visibility plaintext
```

### Step 2: Build APK

```bash
# Build for production
npx eas-cli build -p android --profile production

# This will:
# 1. Upload code to Expo servers
# 2. Build APK in cloud
# 3. Provide download link

# Wait for build (~10-15 minutes)
# You'll get: https://expo.dev/artifacts/[build-id]
```

### Step 3: Download and Test

1. Click the download link on your phone
2. Install APK
3. Open app
4. Test:
   - Create new account
   - Sign in with email
   - Perform transaction
   - Buy tokens (KSh 1)
   - Verify backend receives data

✅ **Production app ready!**

---

## PHASE 5: PRODUCTION VERIFICATION (30 minutes)

### Checklist

**Backend Health:**
- [ ] Health check responds: `/v1/health`
- [ ] Database connected (Neon)
- [ ] No errors in Railway logs
- [ ] PayHero callback URL updated

**Mobile App:**
- [ ] Connects to Railway backend
- [ ] User registration works
- [ ] Email codes arrive
- [ ] Transactions save correctly
- [ ] Sync works when online

**Payment Flow:**
- [ ] Token purchase initiates
- [ ] PayHero callback received
- [ ] Payment verifies successfully
- [ ] Tokens credited
- [ ] Transaction recorded

**Admin Back Office:**
- [ ] Accessible at: `https://[railway-url]/admin`
- [ ] Can login
- [ ] Can view accounts
- [ ] Can verify payments
- [ ] Dashboard shows stats

---

## TROUBLESHOOTING

### Railway Deployment Fails

**Error: "Build failed"**
```bash
# Check Railway logs
railway logs

# Common fixes:
# 1. Clear build cache
railway up --force

# 2. Check start command in Settings
# Should be: npm run start -w @paspesa/backend

# 3. Verify DATABASE_URL is set
railway variables
```

**Error: "Health check failed"**
```bash
# Backend might be starting on wrong port
# Verify environment variables:
railway variables get PORT
# Should be: 3000

# Check if backend actually started
railway logs --tail
# Look for: [paspesa] backend listening on...
```

### Database Connection Fails

**Error: "ECONNREFUSED" or "authentication failed"**

Check:
1. DATABASE_URL is correct (from Neon dashboard)
2. Password has no special characters needing escaping
3. SSL mode is `?sslmode=require`
4. Neon project is not suspended (check Neon dashboard)

**Fix:**
```bash
# Update DATABASE_URL in Railway
railway variables set DATABASE_URL="postgresql://..."

# Redeploy
railway up
```

### PayHero Callbacks Not Working

**Callback URL not receiving requests:**

1. Check Railway logs: `railway logs --tail`
2. Verify URL in PayHero dashboard matches Railway domain
3. Test endpoint manually:
   ```bash
   curl -X POST https://[railway-url]/v1/payments/payhero/callback \
     -H "Content-Type: application/json" \
     -d '{"test": "callback"}'
   ```
4. Should see in logs: "Callback received"

**Payments stuck in PENDING:**
- Backend is still polling PayHero every 5 seconds
- Callback just speeds it up
- Payment will verify within 30 seconds even without callback

### Mobile App Cannot Connect

**Error: "Network request failed"**

Check:
1. EXPO_PUBLIC_PASPESA_API_URL is correct
2. Railway backend is running (check Railway dashboard)
3. Phone has internet connection
4. Try in browser: `https://[railway-url]/v1/health`

**Fix: Rebuild with correct URL**
```bash
cd apps/mobile

# Check current value
npx eas-cli env:list

# Update if wrong
npx eas-cli env:set \
  --name EXPO_PUBLIC_PASPESA_API_URL \
  --value https://[correct-railway-url] \
  --environment production

# Rebuild
npx eas-cli build -p android --profile production
```

---

## POST-DEPLOYMENT: CREATE FIRST ADMIN

**Connect to Production Database:**

Option 1: Via Railway CLI
```bash
# Get Railway connection
railway run bash

# Inside Railway container:
npm run admin -w @paspesa/backend -- admin:create \
  you@example.com \
  "Your Name" \
  ADMIN \
  'YourSecurePassword123!'
```

Option 2: Via Direct Database Connection
```bash
# Set Neon DATABASE_URL locally
DATABASE_URL="postgresql://pascal:...@ep-....neon.tech/paspesa?sslmode=require" \
  npm run admin -w @paspesa/backend -- admin:create \
  you@example.com \
  "Your Name" \
  ADMIN \
  'YourSecurePassword123!'
```

**Verify:**
1. Go to `https://[railway-url]/admin`
2. Login with email and password
3. Should see dashboard

✅ **Admin access configured!**

---

## MONITORING & MAINTENANCE

### Daily Checks (First Week)

```bash
# Check Railway logs for errors
railway logs --tail

# Check payment success rate
# In back office: Admin → Payments
# Target: >95% successful

# Check database size (Neon dashboard)
# Free tier limit: 512MB
# Alert at: 400MB (80%)
```

### Weekly Backups

Neon does automatic daily backups, but good practice:

```bash
# Manual backup
pg_dump -h ep-[random].eu-central-1.aws.neon.tech \
        -U pascal \
        -d paspesa \
        -F custom \
        -f "backups/paspesa_$(date +%Y%m%d).dump"

# Store somewhere safe (Google Drive, Dropbox)
```

### Railway Free Tier Limits

**Hobby Plan ($5 credit/month):**
- Uptime: ~148 hours (~6 days continuous)
- After credit used: $0.000463/GB-hour
- Monitor usage: Railway dashboard → Usage

**What happens when credit runs out:**
- Backend stops if no payment method added
- Add credit card to continue (charges only for usage beyond $5)
- Or pause until next month's credit

**To extend free usage:**
- Optimize memory usage
- Implement auto-sleep for inactive periods
- Or add payment method for pay-as-you-go

---

## SCALING LATER (When Revenue Comes)

### When to Upgrade

**Neon Database:**
- Free → Pro ($19/mo) when:
  - Database > 512MB
  - Need more compute power
  - Need point-in-time recovery
  - Need read replicas

**Railway:**
- Hobby → Pro ($20/mo) when:
  - Need 24/7 uptime guarantee
  - Multiple backend instances
  - Higher traffic (>$5/mo usage)

### Cost Calculator

**Current (Free):**
- Railway: $0 (using $5 credit)
- Neon: $0 (forever free)
- **Total: $0/month**

**Small Scale (~100 users):**
- Railway: $5-10/mo
- Neon: $0 (still free)
- **Total: $5-10/month**

**Medium Scale (~1000 users):**
- Railway Pro: $20/mo (includes $20 usage)
- Neon Pro: $19/mo
- **Total: ~$40/month**

---

## QUICK REFERENCE

### Important URLs

**Production Backend:**
```
https://paspesa-backend-production.up.railway.app
```

**Health Check:**
```
https://paspesa-backend-production.up.railway.app/v1/health
```

**Admin Back Office:**
```
https://paspesa-backend-production.up.railway.app/admin
```

**PayHero Callback:**
```
https://paspesa-backend-production.up.railway.app/v1/payments/payhero/callback
```

### Key Commands

```bash
# Railway
railway logs                  # View logs
railway logs --tail           # Follow logs
railway status                # Check deployment status
railway open                  # Open Railway dashboard
railway run [command]         # Run command in production
railway variables             # List environment variables

# Local testing
npm test                      # Run all tests
npm run typecheck             # Check TypeScript
npm run dev                   # Run backend locally

# Admin commands
npm run admin -w @paspesa/backend -- help
npm run admin -w @paspesa/backend -- admin:list
npm run admin -w @paspesa/backend -- trace [email]
```

### Emergency Contacts

**If Production Goes Down:**
1. Check Railway status: https://railway.app/status
2. Check Neon status: https://neon.tech/status
3. View Railway logs: `railway logs`
4. Restart service: Railway dashboard → Redeploy

**If Payments Fail:**
1. Check PayHero status (contact support)
2. Verify callback URL in PayHero dashboard
3. Check Railway logs for payment errors
4. Backend still polls PayHero every 5s (callback just speeds up)

---

## DEPLOYMENT COMPLETE! 🎉

You now have:
- ✅ Backend running on Railway (free)
- ✅ Database on Neon (free forever)
- ✅ PayHero callbacks working
- ✅ Production mobile app
- ✅ Admin back office accessible
- ✅ Zero monthly costs (while in free tier)

**Next Steps:**
1. Test thoroughly with small payments
2. Invite beta users (5-10 people)
3. Monitor for 1 week
4. Fix any issues
5. Launch to wider audience

**Support:**
- Railway docs: https://docs.railway.app
- Neon docs: https://neon.tech/docs
- PayHero support: WhatsApp (from their dashboard)

---

**Deployment Guide Version:** 1.0  
**Last Updated:** 2026-11-22  
**Estimated Setup Time:** 2-3 hours total
