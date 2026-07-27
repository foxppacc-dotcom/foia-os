#!/bin/bash
# Get full token and save it
curl -s -X POST http://localhost:4001/api/login -H "Content-Type: application/json" -d '{"email":"admin@foia.com","password":"admin123"}' > /c/Users/Work/foia-os/login_resp.json
# Extract token using grep/sed
TOKEN=$(grep -o '"token":"[^"]*"' /c/Users/Work/foia-os/login_resp.json | sed 's/"token":"//;s/"//')
echo "$TOKEN" > /c/Users/Work/foia-os/foia_token.txt
echo "Token saved: ${#TOKEN} chars"
