# Paspesa Production Deployment - Final Checklist

**Status:** Backend deployed ✅ | Mobile app ready ⏳ | Testing pending ⏳

---

## ✅ COMPLETED

### 1. Database Setup
- [x] Neon PostgreSQL created and configured
- [x] DATABASE_URL: `postgresql://neondb_owner:...@ep-mute-sea-bhf35jlr-pooler.c-10.eu-central-1.aws.neon.tech/neondb`
- [x] Schema deployed automatically
- [x] 68/68 backend tests passing

### 2. Backend Deployment
- [x] Railway project created: `paspesa-production`
- [x] GitHub repo connected: `PascalTwoli/paspesa`
- [x] Environment variables configured
- [x] Service deployed successfully
- [x] Public URL: https://paspesa-production.up.railway.app
- [x] Health check passing: `/v1/health` returns `{"ok":true}`

### 3. Mobile App Configuration
- [x] Updated `apps/mobile/.env` with production URL
- [x] Updated `apps/mobile/.env.example` with production URL

---

## 🔄 IN PROGRESS

### 4. PayHero Configuration
**ACTION REQUIRED:**

1. **Update PayHero Callback URL**
   - Go to: https://app.payhero.co.ke/api-keys
   - Find your API Key (Channel ID: 15710)
   - Update the Callback URL to:
     ```
     https://paspesa-production.up.railway.app/v1/payments/payhero/callback
     ```
   - Save changes

2. **Verify Railway Environment Variable**
   - Check Railway dashboard: https://railway.app/project/a79b9f3a-75d6-4060-9d23-bf51fe0d2330
   - Ensure `PAYHERO_CALLBACK_URL` is set to:
     ```
     https://paspesa-production.up.railway.app/v1/payments/payhero/callback
     ```
   - If not set, add it and redeploy

---

## ⏳ PENDING

### 5. Build Production Android APK

**Option A: Development Build (Faster, for testing)**
```bash
cd apps/mobile
npx expo start
# Scan QR code with Expo Go app on Android phone
```

**Option B: Production APK (Standalone app)**
```bash
cd apps/mobile
npx eas build --platform android --profile production
```

This will:
- Build a standalone APK
- Include the production backend URL
- Create an installable .apk file
- Take 10-15 minutes (runs on Expo's servers)

### 6. End-to-End Payment Test

**Test Flow:**
1. Install app on Android device
2. Create new account or sign in
3. Navigate to Buy Airtime
4. Enter: Phone: 0712345678, Amount: 10 KES
5. Click "Buy Now"
6. Complete M-Pesa prompt on phone
7. Verify:
   - Payment shows "Pending" in app
   - Payment updates to "Confirmed" after M-Pesa
   - Wallet balance updates
   - Airtime is allocated

**What to Check:**
- [ ] App connects to production backend
- [ ] Payment request created successfully
- [ ] M-Pesa STK push received on phone
- [ ] Payment confirmation received via callback
- [ ] Transaction visible in app history
- [ ] Wallet balance correct
- [ ] Admin panel shows transaction (if accessed)

### 7. Monitoring & Logs

**Check Railway Logs:**
```bash
railway logs --tail
```

Or in dashboard: https://railway.app/project/a79b9f3a-75d6-4060-9d23-bf51fe0d2330

**Expected Log Messages:**
```
[paspesa] payments: payhero (default payhero)
[paspesa] sign-in emails: SMTP via smtp.gmail.com
[paspesa] backend listening on http://0.0.0.0:3000 (database: PostgreSQL)
```

**During Payment:**
```
[PayHero] Payment request created: pay_xxxxx
[PayHero] Callback received: pay_xxxxx status=SUCCESS
```

---

## 📊 Cost Tracking

**Current Setup (FREE TIER):**
- ✅ Neon: FREE forever (512MB database)
- ✅ Railway: $5 credit (should last ~30 days)
- ✅ Expo: FREE (development builds)

**Expected Railway Usage:**
- Backend: ~$0.10/day = $3/month
- Egress: ~$0.50/month (if low traffic)
- **Total: ~$3.50/month** (covered by $5 credit first month)

**After Free Credit Runs Out:**
You can:
1. Use Railway Hobby Plan ($5/month)
2. Switch to Render.com (another free trial)
3. Deploy to your own VPS

---

## 🔐 Security Notes

**IMPORTANT:**
- ✅ All secrets are in `.env` files (gitignored)
- ✅ No credentials in git history
- ✅ HTTPS enabled on Railway (automatic)
- ✅ Neon database requires SSL (automatic)
- ⚠️  Gmail App Password is used (not main password)

**Recommendation for Future:**
- Consider moving secrets to a secret manager (Doppler, Railway Secrets)
- Enable 2FA on PayHero account
- Monitor Railway usage daily

---

## 🚀 Next Immediate Steps

**Priority 1: Update PayHero Callback**
1. Open PayHero dashboard
2. Update callback URL to production Railway domain
3. Verify in Railway that `PAYHERO_CALLBACK_URL` env var is set

**Priority 2: Test with Expo Go (Fastest)**
```bash
cd apps/mobile
npx expo start
# Scan QR code with phone
```

**Priority 3: Run Test Payment**
- Use small amount (10 KES)
- Monitor Railway logs during payment
- Verify full flow works

**Priority 4: Build Production APK (If test passes)**
```bash
cd apps/mobile
npx eas build --platform android --profile production
```

---

## 📝 Notes

- Backend is fully deployed and healthy ✅
- Mobile app is configured for production ✅
- PayHero callback needs updating ⚠️
- Ready for testing once PayHero is updated ⏳

**Estimated Time to Launch:** 30 minutes (mostly testing)

---

## 🆘 Troubleshooting

**Backend not responding:**
- Check Railway logs: `railway logs --tail`
- Verify service is "Active" in Railway dashboard
- Check environment variables are set

**Payment not working:**
- Verify PayHero callback URL is correct
- Check Railway logs for PayHero errors
- Ensure `PAYHERO_CALLBACK_URL` env var is set
- Verify Till 15710 is active in PayHero

**App can't connect to backend:**
- Verify `.env` has production URL
- Restart Expo dev server: `npx expo start --clear`
- Check phone has internet connection
- Test health endpoint in browser first

**M-Pesa prompt not appearing:**
- Verify PayHero credentials are correct
- Check phone number format (254712345678)
- Ensure Till 15710 accepts payments
- Check Railway logs for PayHero API errors

---

Ready to continue? Let me know when PayHero callback is updated! 🚀
