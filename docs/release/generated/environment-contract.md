# Environment and Binding Contract

Generated from source `process.env.*` references and local/deployment configuration presence. Values are never read into this document.

`configured` means at least one named variable is non-empty in the inspected local/deployment configuration; it is not live-provider certification.

| System / binding | Required / optional status | Referenced variable names | Environment presence | Binding / write-enable variable |
| --- | --- | --- | --- | --- |
| Postgres | required | `DATABASE_URL`, `MIGRATIONS_DATABASE_URL`, `POSTGRES_URL` | missing | not applicable / not configured |
| Redis | required | `REDIS_URL` | missing | not applicable / not configured |
| FINNOR release identity | required on every runtime | `FINNOR_BUILD_ID`, `FINNOR_COMMIT_SHA`, `FINNOR_ENVIRONMENT`, `FINNOR_RELEASE_SOURCE`, `FINNOR_VERSION` | missing | not applicable / not configured |
| AWS ECS Fargate runtime | required by the production release workflow | `AWS_REGION`, `FINNOR_WORKER_CAPABILITIES`, `FINNOR_WORKER_DEPLOYMENT_ID` | missing | not applicable / not configured |
| Sentry | optional unless error reporting is enabled | `SENTRY_DSN` | missing | not applicable / not configured |
| Supabase auth | required | `FINNOR_OS_SUPABASE_KEY`, `FINNOR_OS_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | missing | not applicable / not configured |
| Vapi | required if voice is enabled | `NEXT_PUBLIC_VAPI_ASSISTANT_ID`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID`, `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_DAILY_CALL_CAP`, `VAPI_DEFAULT_TENANT_ID`, `VAPI_PHONE_NUMBER_ID`, `VAPI_TEST_PHONE_NUMBER`, `VAPI_WEBHOOK_SECRET` | missing | not applicable / not configured |
| OpenAI Realtime | required if Realtime is enabled | none referenced | missing | not applicable / not configured |
| Bedrock LLM chain | required for the configured GLM/Mistral/DeepSeek chain | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_BEDROCK_API_KEY`, `AWS_BEDROCK_DEEPSEEK_MODEL_ID`, `AWS_BEDROCK_GLM_MODEL_ID`, `AWS_BEDROCK_MISTRAL_MODEL_ID`, `AWS_BEDROCK_REGION` | missing | not applicable / not configured |
| GLM provider family | required if selected by router | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_BEDROCK_API_KEY`, `AWS_BEDROCK_GLM_MODEL_ID` | missing | not applicable / not configured |
| Mistral | required if selected by router | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_BEDROCK_API_KEY`, `AWS_BEDROCK_MISTRAL_MODEL_ID`, `MISTRAL_API_BASE_URL`, `MISTRAL_API_KEY`, `MISTRAL_MODEL` | missing | not applicable / not configured |
| DeepSeek | required if selected by router | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_BEDROCK_API_KEY`, `AWS_BEDROCK_DEEPSEEK_MODEL_ID`, `DEEPSEEK_API_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | missing | not applicable / not configured |
| Exa | required for web discovery | `EXA_API_KEY` | missing | not applicable / not configured |
| Firecrawl | required for verified web facts | `FIRECRAWL_API_BASE_URL`, `FIRECRAWL_API_KEY` | missing | not applicable / not configured |
| Embeddings | optional unless semantic evidence is enabled | `EMBEDDINGS_API_KEY` | missing | not applicable / not configured |
| Zep | optional | `ZEP_API_KEY` | missing | not applicable / not configured |
| Stripe | required when Stripe binding is selected | `PAYMENTS_BINDING`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | missing | not applicable / not configured |
| QuickBooks | required when QuickBooks binding is selected | `ACCOUNTING_BINDING`, `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REALM_ID`, `QUICKBOOKS_REFRESH_TOKEN` | missing | not applicable / not configured |
| DocuSign | required when DocuSign binding is selected | `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URL`, `DOCUSIGN_CONNECT_SECRET`, `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_PRIVATE_KEY`, `DOCUSIGN_USER_ID` | missing | not applicable / not configured |
| Communications / SMS | required when external communications binding is selected | `COMMS_MODE`, `COMMUNICATIONS_BINDING`, `GMAIL_APP_PASSWORD`, `GMAIL_USER`, `RESEND_ALLOWLIST_OWNER_EMAIL`, `RESEND_API_KEY`, `RESEND_DAILY_CAP` | missing | not applicable / not configured |
| Resend / email | required when Resend is selected | `RESEND_ALLOWLIST_OWNER_EMAIL`, `RESEND_API_KEY`, `RESEND_DAILY_CAP` | missing | not applicable / not configured |
| GoHighLevel | required when GHL CRM binding is selected | `CRM_BINDING`, `GHL_WEBHOOK_PUBLIC_KEY`, `GOHIGHLEVEL_API_KEY` | missing | not applicable / not configured |
| Meta Ads | required when live marketing binding is selected | `MARKETING_BINDING`, `META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID`, `META_ADS_WRITE_ENABLED` | missing | not applicable / not configured |
| Google Ads | required when Google Ads is selected | `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_WRITE_ENABLED` | missing | not applicable / not configured |
| OSRM / routing | required when external routing is selected | none referenced | missing | not applicable / not configured |
| Secrets provider | required when external secret provider is selected | `AWS_BEARER_TOKEN_BEDROCK`, `AWS_BEDROCK_API_KEY`, `AWS_BEDROCK_DEEPSEEK_MODEL_ID`, `AWS_BEDROCK_GLM_MODEL_ID`, `AWS_BEDROCK_MISTRAL_MODEL_ID`, `AWS_BEDROCK_NOVA_MICRO_MODEL_ID`, `AWS_BEDROCK_OPENAI_OSS_MODEL_ID`, `AWS_BEDROCK_QWEN_FAST_MODEL_ID`, `AWS_BEDROCK_QWEN_PLANNING_MODEL_ID`, `AWS_BEDROCK_QWEN_PLANNING_REGION`, `AWS_BEDROCK_REGION`, `AWS_REGION`, `FINNOR_SECRET_IDS`, `SECRETS_PROVIDER` | missing | not applicable / not configured |

## Capability binding resolution

Source: `finnor-os/packages/tools/src/binding-resolution.ts`. Finnor-owned capabilities default to `native`; external capabilities default to `emulator`. Tenant integration rows override environment/default resolution.

| Capability | Environment variable | Default mode | Live mode |
| --- | --- | --- | --- |
| scheduling | `SCHEDULING_BINDING` | native | native / configured value |
| documents | `DOCUMENTS_BINDING` | native | native / configured value |
| inventory | `INVENTORY_BINDING` | native | native / configured value |
| crm | `CRM_BINDING` | native | ghl / configured value |
| communications | `COMMUNICATIONS_BINDING` | emulator | vapi |
| esign | `ESIGN_BINDING` | emulator | docusign |
| accounting | `ACCOUNTING_BINDING` | emulator | quickbooks |
| payments | `PAYMENTS_BINDING` | emulator | stripe |
| marketing | `MARKETING_BINDING` | emulator | dry_run / configured value |
