const axios = require('axios');

const TALLY_URL = 'http://localhost:9000';

const xml = `
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>Water Service_s</SVCURRENTCOMPANY>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
`;

async function getVouchers() {
    try {
        console.log("Fetching Vouchers from Tally...");
        const res = await axios.post(TALLY_URL, xml, {
            headers: { 'Content-Type': 'text/xml' }
        });
        
        // Save to file since output might be large
        require('fs').writeFileSync('tally_export.xml', res.data);
        console.log("Saved export to tally_export.xml");
    } catch (err) {
        console.error("Error:", err.message);
    }
}

getVouchers();
