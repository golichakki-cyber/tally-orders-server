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
                <REPORTNAME>Company Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
`;

// Alternative to get basic system info
const systemInfoXML = `
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <TDL>
                    <TDLMESSAGE>
                        <REPORT NAME="SysInfoReport">
                            <FORMS>SysInfoForm</FORMS>
                        </REPORT>
                        <FORM NAME="SysInfoForm">
                            <PARTS>SysInfoPart</PARTS>
                        </FORM>
                        <PART NAME="SysInfoPart">
                            <LINES>SysInfoLine</LINES>
                        </PART>
                        <LINE NAME="SysInfoLine">
                            <FIELDS>SysInfoField</FIELDS>
                        </LINE>
                        <FIELD NAME="SysInfoField">
                            <SET>@@CSP</SET>
                        </FIELD>
                    </TDLMESSAGE>
                </TDL>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
`;

// Simple info fetch using Tally System Variables
const simpleInfoXML = `
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Voucher Register</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
</ENVELOPE>
`;

async function getInfo() {
    try {
        console.log("Fetching Tally Info...");
        const res = await axios.post(TALLY_URL, simpleInfoXML, {
            headers: { 'Content-Type': 'text/xml' }
        });
        require('fs').writeFileSync('tally_info.xml', res.data);
        console.log("Saved info to tally_info.xml");
    } catch (err) {
        console.error("Error:", err.message);
    }
}

getInfo();
