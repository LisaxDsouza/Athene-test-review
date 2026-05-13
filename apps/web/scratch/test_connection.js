const { Nango } = require('@nangohq/node');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const nango = new Nango({
    secretKey: process.env.NANGO_SECRET_KEY
});

async function testConnection(providerConfigKey, connectionId) {
    console.log(`Testing connection: ${providerConfigKey} / ${connectionId}`);
    try {
        const connection = await nango.getConnection(providerConfigKey, connectionId);
        console.log('✅ Connection found in Nango:');
        console.log(JSON.stringify(connection, null, 2));

        // Try to fetch a token to verify it's working
        console.log('\nAttempting to fetch access token...');
        const token = await nango.getToken(providerConfigKey, connectionId);
        console.log('✅ Token fetched successfully.');
        // console.log('Token:', token.slice(0, 10) + '...');

    } catch (error) {
        console.error('❌ Connection test failed:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node test_connection.js <providerConfigKey> <connectionId>');
    process.exit(1);
}

testConnection(args[0], args[1]);
