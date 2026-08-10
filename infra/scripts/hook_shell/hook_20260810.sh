SCRIPT_DIR=/root/Costra/infra/scripts

${SCRIPT_DIR}/migrate-ledger-asset.sh --target prod -y
${SCRIPT_DIR}/import-holidays.sh -y --target prod 2026

echo "hook run end ==============="
