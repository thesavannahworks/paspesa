import { Project, type ProjectInputs } from "@railway/sdk";

// Paspesa Production Deployment
// Backend + Neon Database (free tier)

const project: ProjectInputs = {
  name: "paspesa-production",
  environments: {
    production: {
      services: {
        backend: {
          source: {
            repo: "PascalTwoli/paspesa",
            branch: "main",
            rootDirectory: "apps/backend",
          },
          buildCommand: "cd ../.. && npm install && npm run typecheck -w @paspesa/backend",
          startCommand: "cd ../.. && npm run start -w @paspesa/backend",
          variables: {
            PORT: "3000",
            HOST: "0.0.0.0",
            // DATABASE_URL: Set via Railway dashboard (from Neon)
            // PAYHERO_*: Set via Railway dashboard
            // SMTP_*: Set via Railway dashboard
          },
        },
      },
    },
  },
};

export default new Project(project);
