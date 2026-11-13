#!/bin/bash
set -euo pipefail

NAME="Tack Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
OPENSSL=/usr/bin/openssl

if security find-identity -p codesigning | grep -q "$NAME"; then
  echo "\"$NAME\" already exists. Nothing to do."
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=$($OPENSSL rand -hex 16)

cat >"$WORK/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

$OPENSSL req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -config "$WORK/cert.cnf" -extensions ext
$OPENSSL pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -name "$NAME" -out "$WORK/cert.p12" -passout "pass:$PASS"

security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign

echo "macOS now asks for your login password to trust the certificate for code signing."
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem"

security find-identity -p codesigning | grep "$NAME"
echo "Done. Run scripts/install.sh next."
