import {spawnSync} from 'node:child_process';
import {useJava} from './java-home.mjs';
useJava();
const result=spawnSync('npx.cmd firebase emulators:exec --only auth,firestore,storage --project demo-pilateacher --config firebase.integration-test.json "node --test tests/integration/sharing-auth.test.cjs"',{shell:true,stdio:'inherit',env:process.env});
process.exit(result.status??1);
