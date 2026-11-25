# Resend Email Setup - Final Steps

## ✅ What's Done:
- Resend SDK installed
- Backend code updated to use Resend
- Changes pushed to GitHub
- Railway will auto-deploy

## 📋 What You Need to Do:

### 1. Get Your Resend API Key

1. Go to: https://resend.com/api-keys
2. Click **"Create API Key"**
3. Name: `paspesa-production`
4. Copy the key (starts with `re_...`)

### 2. Add to Railway

Run this command (replace with your actual key):

```bash
railway variables --set RESEND_API_KEY=re_your_actual_key_here
railway variables --set MAIL_FROM="Paspesa <onboarding@resend.dev>"
```

Or via Railway Dashboard:
1. Go to: https://railway.app/project/a79b9f3a-75d6-4060-9d23-bf51fe0d2330
2. Click your service → Variables tab
3. Add:
   - `RESEND_API_KEY` = `re_your_key_here`
   - `MAIL_FROM` = `Paspesa <onboarding@resend.dev>`

### 3. Wait for Deploy

Railway will automatically redeploy (takes ~2 minutes).

### 4. Test It!

1. Open mobile app or web
2. Sign in with your email
3. **Check your email inbox** - you should receive a 6-digit code!
4. Enter the code and you're in!

---

## 📧 Free Tier Limits:

**Resend Free Plan:**
- ✅ 100 emails/day
- ✅ 3,000 emails/month
- ✅ No credit card required
- ✅ No custom domain needed (uses onboarding@resend.dev)

Perfect for testing and early users!

---

## 🔧 Optional: Add Custom Domain Later

If you want branded emails (`noreply@paspesa.com`):

1. Buy a domain (Namecheap, Google Domains, etc.)
2. Add it in Resend dashboard
3. Update DNS records (they'll show you which)
4. Change `MAIL_FROM` to your domain

But you don't need this now - `onboarding@resend.dev` works fine!

---

## ✅ Summary:

Right now your backend is using **console logging** for sign-in codes.

After you add `RESEND_API_KEY`:
- ✅ Real emails will be sent via Resend
- ✅ Users receive codes in their inbox
- ✅ No more checking Railway logs
- ✅ Ready for real users!

**Let me know when you've added the API key and I'll verify it's working!** 🚀
