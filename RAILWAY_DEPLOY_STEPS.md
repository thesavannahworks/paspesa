# Railway Deployment - Step by Step

## You already have:
- ✅ Railway CLI installed and authenticated
- ✅ Railway project "paspesa-production" created
- ✅ Project linked locally

## Next Steps (5-10 minutes):

### 1. Open Railway Dashboard
Go to: https://railway.app/dashboard

You should see your "paspesa-production" project.

### 2. Add a Service from GitHub

1. Click on your "paspesa-production" project
2. Click "+ New" button
3. Select "GitHub Repo"
4. Choose "PascalTwoli/paspesa"
5. Click "Deploy Now"

### 3. Configure the Service

After the service is created:

1. Click on the service (it will be called "paspesa" or similar)
2. Go to "Settings" tab
3. Scroll to "Build & Deploy" section:
   - **Root Directory**: Leave blank (monorepo will be detected)
   - **Build Command**: `npm install && npm run typecheck -w @paspesa/backend`
   - **Start Command**: `npm run start -w @paspesa/backend`
4. Click "Save Changes"

### 4. Add Environment Variables

Still in the service settings:

1. Go to "Variables" tab
2. Click "+ New Variable" for each of these:

```
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://neondb_owner:npg_pgUViQc3rLX6@ep-mute-sea-bhf35jlr-pooler.c-10.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require
PAYHERO_BASIC_TOKEN=Basic MnhSMElQZDZmZEhvQ3BaV1NlVzQ6S09CU0MwN0xxU2o0OUJoWVpzd25hZ2lGNEtCNE9sNTkzZlp3aEdDSQ==
PAYHERO_CHANNEL_ID=15710
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=thesavannahworks@gmail.com
SMTP_PASS=rdlh yxlo slzp tegn
MAIL_FROM=Paspesa <thesavannahworks@gmail.com>
```

**NOTE:** We'll set `PAYHERO_CALLBACK_URL` after we get the Railway domain (Step 6)

### 5. Enable Public Access

1. Still in service settings, go to "Networking" tab
2. Click "Generate Domain" under "Public Networking"
3. Copy the generated domain (something like: `paspesa-production-xxxx.up.railway.app`)

### 6. Update PayHero Callback URL

1. Go back to "Variables" tab
2. Add one more variable:
   ```
   PAYHERO_CALLBACK_URL=https://paspesa-production-xxxx.up.railway.app/v1/payments/payhero/callback
   ```
   (Replace `paspesa-production-xxxx` with your actual domain from Step 5)

### 7. Trigger Deployment

The service should automatically redeploy after adding variables. If not:

1. Go to "Deployments" tab
2. Click "Deploy" button

### 8. Monitor Deployment

Watch the deployment logs:
1. Go to "Deployments" tab
2. Click on the latest deployment
3. Watch the build logs

**Expected success indicators:**
- ✅ Build completes successfully
- ✅ Service status shows "Active"
- ✅ Logs show: `[paspesa] backend listening on http://0.0.0.0:3000 (database: PostgreSQL)`
- ✅ Logs show: `[paspesa] payments: payhero (default payhero)`

### 9. Test the Deployment

Open in browser:
```
https://your-railway-domain.up.railway.app/v1/health
```

Should return:
```json
{"ok":true,"service":"paspesa-backend","apiVersion":1}
```

### 10. Update PayHero Dashboard

**IMPORTANT:** Update your PayHero callback URL:

1. Go to https://app.payhero.co.ke
2. Navigate to API Settings
3. Update callback URL to your Railway domain:
   ```
   https://your-railway-domain.up.railway.app/v1/payments/payhero/callback
   ```

---

## If you run into issues:

**Build fails:**
- Check the build logs in Railway dashboard
- Common fix: Clear build cache (Settings → "Clear Build Cache")

**Service crashes:**
- Check runtime logs in Railway dashboard
- Verify all environment variables are set correctly
- Verify DATABASE_URL is correct

**Can't connect to database:**
- Verify DATABASE_URL in Railway matches your Neon connection string
- Check Neon dashboard to ensure database is active

---

## After successful deployment:

1. **Save your Railway URL** - you'll need it for the mobile app
2. **Update the mobile app** with the production URL
3. **Build the production Android APK**
4. **Test an end-to-end payment**

Ready? Let's do this! 🚀
