const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

let updateAttendanceSmsStatus, testDbConnection;
try {
    const db = require('./db');
    updateAttendanceSmsStatus = db.updateAttendanceSmsStatus;
    testDbConnection = db.testDbConnection;
    if (testDbConnection) testDbConnection();
} catch (e) {
    console.log('⚠️ db.js उपलब्ध नहीं है या स्किप किया गया।');
}

const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1CPviWaISRLeTB6wgSPKSjep78v7a48cHjs5-n9q4sPGUM_jqlWA2aUd2qbhUXKBC/exec";
const GAS_TOKEN = encodeURIComponent(process.env.API_TOKEN || "");
const HINDI_FEMALE_VOICE = "hi-IN-SwaraNeural";
// 🛡️ ग्लोबल क्रैश शील्ड (नेटवर्क या FFmpeg झटके पर सर्वर कभी बंद नहीं होगा)
process.on('uncaughtException', (err) => console.error('⚠️ Uncaught Exception:', err.message));
process.on('unhandledRejection', (reason) => console.error('⚠️ Unhandled Rejection:', reason));

// 📞 100% सटीक भारतीय नंबर क्लीनर (0, +91, .0 डेसिमल, डबल नंबर — सब सही करेगा)
function normalizeIndianPhone(raw) {
    if (!raw) return null;
    const parts = String(raw).split(/[/,\n|;]+/);
    for (const part of parts) {
        let d = part.trim().replace(/\.\d+$/, '').replace(/[^0-9]/g, '').replace(/^0+/, '');
        if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
        else if (d.length > 12 && d.startsWith('91')) d = d.slice(2, 12);
        if (/^[6-9]\d{9}$/.test(d)) return '91' + d;
    }
    return null;
}

// 🌺 1 से 31 तारीख के प्रातःकालीन प्रेरणादायी विचार (IN-TIME QUOTES)
const inQuotes = {
    1: "एक नए महीने की शुरुआत! आइए, नए संकल्पों के साथ बच्चों के भविष्य को उज्ज्वल बनाएं।",
    2: "शिक्षक वह दीप है जो स्वयं जलकर दूसरों के जीवन को आलोकित करता है। आपका स्वागत है!",
    3: "आप केवल विषय नहीं पढ़ाते, आप देश के भावी नागरिकों का निर्माण करते हैं। शुभ प्रभात!",
    4: "ज्ञान बांटना ही संसार का सबसे महान कार्य है। आपकी मेहनत से कई सपने साकार हो रहे हैं!",
    5: "सफल शिक्षक वह है जो बच्चों में सीखने की जिज्ञासा जगाए। आइए, आज कुछ नया सिखाएं!",
    6: "आपकी एक मुस्कान और मार्गदर्शन से किसी बच्चे का पूरा दिन बदल सकता है। शुभ प्रभात!",
    7: "शिक्षा की जड़े कड़वी होती हैं, पर उसका फल बहुत मीठा होता है। आपकी लगन को नमन!",
    8: "उत्कृष्टता कोई कार्य नहीं, बल्कि एक आदत है। आज फिर एक नई ऊर्जा के साथ शुरुआत करें!",
    9: "सकारात्मक सोच और निष्ठा से किया गया अध्यापन हमेशा अमर रहता है। आपका दिन शुभ हो!",
    10: "बच्चों के मन में ज्ञान का बीज बोना ही शिक्षक का असली सौभाग्य है। कर्मभूमि में स्वागत है!",
    11: "धैर्य और लगन ही एक महान शिक्षक की पहचान है। आपकी उपस्थिति हमारे लिए गर्व की बात है!",
    12: "सच्चा शिक्षक वह है जो बच्चे को उसके भीतर की क्षमता का अहसास कराए। शुभ प्रभात!",
    13: "शिक्षा ही वह सबसे शक्तिशाली हथियार है जिससे दुनिया को बदला जा सकता है। जय हिंद!",
    14: "ज्ञान का दान ही सबसे बड़ा दान है। आज पूरी निष्ठा से अपने दायित्व का निर्वहन करें!",
    15: "महीने का मध्य! अपनी उसी अटूट ऊर्जा और उत्साह के साथ बच्चों का मार्गदर्शन करते रहें।",
    16: "शिक्षकों के मार्गदर्शन के बिना सफलता का कोई भी मुकाम हासिल नहीं किया जा सकता।",
    17: "आपकी मेहनत हर दिन एक नए भारत की नींव रख रही है। आपका आज का दिन मंगलमय हो!",
    18: "शिक्षा केवल अक्षर ज्ञान नहीं, बल्कि चरित्र का निर्माण है। शुभ प्रभात!",
    19: "अनुशासन और प्रेम का संतुलन ही एक आदर्श शिक्षक का आभूषण है। आपका स्वागत है!",
    20: "आपकी दी गई सीख बच्चों के जीवन भर काम आएगी। पूरे उत्साह के साथ कार्य प्रारंभ करें!",
    21: "विद्या ही परम धन है और आप उस धन के संरक्षक हैं। आपका दिन ऊर्जा से भरपूर रहे!",
    22: "एक अच्छा शिक्षक एक प्रकाशस्तंभ की तरह है जो भटकते हुए जहाजों को राह दिखाता है।",
    23: "महान कार्य करने का एक ही तरीका है कि आप अपने काम से प्यार करें। शुभ प्रभात!",
    24: "ज्ञान की ज्योति कभी बुझती नहीं। आपकी लगन से बच्चों का जीवन हमेशा जगमगाएगा।",
    25: "बच्चों के सपनों को पंख देने के इस पावन कार्य में आपका पुनः हार्दिक स्वागत है!",
    26: "हर बच्चा एक खास प्रतिभा लेकर आता है, उसे पहचानने का हुनर आपके पास है।",
    27: "सफलता का कोई संक्षिप्त रास्ता नहीं होता, आपकी निरंतर मेहनत ही इसका प्रमाण है!",
    28: "शिक्षक वह सीढ़ी है जो खुद वहीं रहती है, पर दूसरों को ऊंचाइयों पर पहुंचा देती है।",
    29: "आपकी निष्ठा और समर्पण ही इस विद्यालय की असली ताकत है। शुभ प्रभात!",
    30: "सिखाने की कला ही एक शिक्षक को महान बनाती है। आज फिर कुछ नया रचें!",
    31: "महीने का अंतिम दिन! आपके अथक प्रयासों से इस महीने कई नए अध्याय लिखे गए हैं।"
};

// 🌺 1 से 31 तारीख के सायंकालीन आभार संदेश (OUT-TIME QUOTES)
const outQuotes = {
    1: "महीने के पहले दिन आपकी उत्कृष्ट सेवा और मेहनत के लिए धन्यवाद। विश्राम करें और कल पुनः मिलें!",
    2: "आज दिन भर बच्चों के भविष्य को संवारने में दिए गए योगदान के लिए आभार। आपकी शाम सुखद रहे!",
    3: "दिन भर की निष्ठापूर्ण अध्यापन सेवा के लिए विद्यालय परिवार आपका धन्यवाद करता है। शुभ संध्या!",
    4: "राष्ट्र निर्माण के इस पावन कार्य में आज की आपकी लगन अत्यंत सराहनीय रही। धन्यवाद!",
    5: "एक और सफल कार्य दिवस पूर्ण हुआ! आपके अमूल्य प्रयासों और मार्गदर्शन के लिए हार्दिक धन्यवाद।",
    6: "आज की आपकी मेहनत से कई बच्चों का जीवन समृद्ध हुआ है। विश्राम करें, शुभ संध्या!",
    7: "दिन भर की थकान के बाद अब शांतिपूर्ण विश्राम करें। आपके अमूल्य योगदान का आभार!",
    8: "आपकी निरंतर निष्ठा ही विद्यालय की प्रगति का आधार है। आज के समर्पण के लिए धन्यवाद!",
    9: "आज का कार्य दिवस सफलतापूर्वक संपन्न हुआ। आपकी लगन को JRD परिवार का नमन!",
    10: "बच्चों के उज्ज्वल भविष्य की नींव रखने के लिए धन्यवाद। आपकी शाम आनंदमय रहे!",
    11: "आज दिए गए ज्ञान और संस्कारों के लिए विद्यालय प्रबंधन आपका आभार व्यक्त करता है।",
    12: "मेहनत रंग लाती है! आज के आपके सराहनीय प्रयासों के लिए हार्दिक धन्यवाद। शुभ संध्या!",
    13: "दिन भर के उत्कृष्ट अध्यापन के लिए धन्यवाद। विश्राम करें और कल पुनः नई ऊर्जा से मिलें!",
    14: "ज्ञान के इस पावन यज्ञ में आज की आपकी आहुति के लिए धन्यवाद। आपका समय सुखद हो!",
    15: "मध्य महीने तक आपकी अटूट सेवा के लिए आभार! विश्राम करें और कल पुनः मिलें।",
    16: "आज का दिन बहुत ही फलदायी रहा। आपकी निरंतर मेहनत के लिए हार्दिक धन्यवाद!",
    17: "बच्चों को दिए गए आपके अनमोल समय और ज्ञान के लिए विद्यालय परिवार आभारी है।",
    18: "आज का कार्य दिवस पूर्ण हुआ। आपकी लगन और निष्ठा के लिए कोटि-कोटि धन्यवाद!",
    19: "शिक्षकों के समर्पण से ही विद्यालय का नाम रोशन होता है। आज के योगदान के लिए आभार!",
    20: "आपकी आज की मेहनत से बच्चों ने कुछ नया सीखा है। शुभ संध्या व शांतिपूर्ण रात्रि!",
    21: "दिन भर की उत्कृष्ट सेवा के लिए JRD परिवार आपका आभार व्यक्त करता है। विश्राम करें!",
    22: "शिक्षा के प्रति आपकी सच्ची निष्ठा को नमन! आज का कार्य दिवस सफलतापूर्वक पूर्ण हुआ।",
    23: "बच्चों के सर्वांगीण विकास में आज दिए गए आपके योगदान के लिए हार्दिक धन्यवाद!",
    24: "एक और प्रेरक दिन संपन्न हुआ! आपकी अटूट मेहनत के लिए धन्यवाद, शुभ संध्या!",
    25: "ज्ञान बांटने का आज का आपका सफर बहुत ही सराहनीय रहा। विश्राम करें!",
    26: "आपकी उपस्थिति और मार्गदर्शन ही बच्चों की असली ताकत है। आज के लिए धन्यवाद!",
    27: "दिन भर की थकान के बाद अब अपने परिवार के साथ सुखद समय बिताएं। आभार!",
    28: "आपकी निष्ठा से विद्यालय नित नई ऊंचाइयों को छू रहा है। आज की सेवा के लिए धन्यवाद!",
    29: "सफल कार्य दिवस की बधाई! आपके अमूल्य प्रयासों के लिए विद्यालय परिवार आभारी है।",
    30: "आज के समर्पित अध्यापन कार्य के लिए धन्यवाद। आपकी शाम सुखद और शांतिपूर्ण रहे!",
    31: "पूरे महीने आपकी अथक मेहनत और समर्पित सेवा के लिए JRD परिवार आपका हार्दिक आभार व्यक्त करता है!"
};
// 📖 1 से 31 तारीख के छात्र दैनिक प्रेरक विचार
const studentQuotes = {
    1: "परिश्रम ही सफलता की असली कुंजी है।",
    2: "विद्या ददाति विनयं, विनयाद् याति पात्रताम्।",
    3: "अनुशासन ही लक्ष्य और उपलब्धि के बीच का सेतु है।",
    4: "ज्ञान वह सबसे शक्तिशाली हथियार है जिससे दुनिया बदली जा सकती है।",
    5: "समय का सही सदुपयोग ही महानता की पहली सीढ़ी है।",
    6: "सच्ची शिक्षा वही है जो इंसान को विनम्र और समझदार बनाए।",
    7: "कठिन अभ्यास ही भविष्य को सरल और उज्ज्वल बनाता है।",
    8: "अच्छी आदतें और अच्छी पुस्तकें जीवन को संवारती हैं।",
    9: "हर दिन कुछ नया सीखना ही सच्ची प्रगति है।",
    10: "सफलता कोई मंजिल नहीं, यह एक सतत अभ्यास है।",
    11: "गुरु और माता-पिता का सम्मान ही उन्नति का आधार है।",
    12: "जिज्ञासा और एकाग्रता ज्ञान प्राप्ति के दो मुख्य नेत्र हैं।",
    13: "स्वच्छ विचार और मधुर वाणी विद्यार्थी के सच्चे आभूषण हैं।",
    14: "गलतियों से सीखकर आगे बढ़ना ही बुद्धिमानी है।",
    15: "आत्मविश्वास और दृढ़ संकल्प से हर लक्ष्य संभव है।",
    16: "शिक्षा केवल परीक्षा पास करना नहीं, जीवन जीने की कला है।",
    17: "धैर्य और निरंतर प्रयास से हर बाधा पार होती है।",
    18: "सकारात्मक सोच से कठिन कार्य भी आसान हो जाता है।",
    19: "बड़ों का आशीर्वाद और कठिन मेहनत ही विजय दिलाती है।",
    20: "नियमबद्ध जीवन ही सफलता की गारंटी है।",
    21: "ज्ञान बांटने से बढ़ता है, संकोच करने से नहीं।",
    22: "सच्चा विद्यार्थी वही है जो समय की कद्र करता है।",
    23: "सदा सत्य बोलें और अपने कर्तव्यों का निष्ठा से पालन करें।",
    24: "सपनों को सच करने के लिए नींद नहीं, लगन चाहिए।",
    25: "स्वाध्याय (खुद से पढ़ना) विद्यार्थी का सर्वोत्तम मित्र है।",
    26: "सदा विनम्र रहें, विद्या फलदार वृक्ष की तरह झुकना सिखाती है।",
    27: "साहस और ईमानदारी जीवन की सबसे बड़ी पूंजी है।",
    28: "जो समय पर जागता है, वही अपनी तकदीर बनाता है।",
    29: "उत्तम संस्कार ही उत्तम चरित्र का निर्माण करते हैं।",
    30: "लक्ष्य जितना बड़ा होगा, संघर्ष और सफलता उतनी ही शानदार होगी।",
    31: "ईश्वर में विश्वास और कर्म पर निष्ठा ही विजय का मार्ग है।"
};
// ⚠️ 1 से 31 तारीख के अनुपस्थिति (ABSENT) विशेष अनुशासन एवं नियमितता विचार
const absentQuotes = {
    1: "नियमितता ही सफलता की नींव है, एक भी दिन का अभाव प्रगति को धीमा कर देता है।",
    2: "समय का एक-एक पल अनमोल है, छूटा हुआ पाठ दोबारा उसी ऊर्जा से नहीं मिलता।",
    3: "अनुशासन और दैनिक उपस्थिति से ही विद्यार्थी का भविष्य उज्ज्वल बनता है।",
    4: "ज्ञान की निरंतरता ही परीक्षा में सर्वोच्च परिणाम दिलाती है।",
    5: "कठिन परिश्रम और नियमित विद्यालय जाना ही सफलता का मूल मंत्र है।",
    6: "शिक्षा का दीप तभी जलता रहता है जब विद्यार्थी प्रतिदिन कक्षा से जुड़े।",
    7: "एक दिन का विश्राम भी अध्ययन की लय को तोड़ सकता है, सदैव नियमित रहें।",
    8: "लक्ष्य तक वही पहुंचता है जो हर परिस्थिति में अपने कर्तव्य पथ पर अडिग रहे।",
    9: "दैनिक कक्षा में उपस्थित रहना ही उत्तम संस्कारों की पहली पहचान है।",
    10: "सफलता का कोई शार्टकट नहीं होता, दैनिक अध्ययन ही विजय का मार्ग है।",
    11: "गुरु का सानिध्य और दैनिक मार्गदर्शन विद्यार्थी को महान बनाता है।",
    12: "समय का सम्मान करें, क्योंकि बीता हुआ समय कभी वापस नहीं आता।",
    13: "नियमित अभ्यास से कठिन से कठिन विषय भी सरल हो जाता है।",
    14: "प्रतिदिन कुछ नया सीखना ही जीवन में निरंतर आगे बढ़ने का रहस्य है।",
    15: "आलस्य ज्ञान का सबसे बड़ा शत्रु है, नियमित उपस्थिति से इसे परास्त करें।",
    16: "विद्या रूपी धन को पाने के लिए प्रतिदिन विद्यालय रूपी मंदिर आना आवश्यक है।",
    17: "दृढ़ संकल्प और नियमित उपस्थिति से हर बड़ी मंजिल पाई जा सकती है।",
    18: "छूटी हुई कक्षा केवल पाठ का नुकसान नहीं, बल्कि समय का भी नुकसान है।",
    19: "अपने सपनों को सच करने के लिए हर दिन पूरी लगन से कक्षा में जुड़ें।",
    20: "नियमबद्ध जीवन और नियमित अध्ययन ही विद्यार्थी का असली आभूषण है।",
    21: "प्रतिदिन का थोड़ा सा प्रयास भविष्य में विशाल सफलता का रूप लेता है।",
    22: "शिक्षा एक तपस्या है, और दैनिक उपस्थिति इस तपस्या का मुख्य नियम है।",
    23: "सच्चा विद्यार्थी वही है जो विषम परिस्थितियों में भी पढ़ाई को प्राथमिकता दे।",
    24: "आज का किया गया परिश्रम ही कल की स्वर्णिम सफलता तय करता है।",
    25: "लगातार सीखने की ललक ही आपको भीड़ से अलग और उत्कृष्ट बनाती है।",
    26: "कक्षा में बिताया हर मिनट भविष्य के निर्माण में एक ईंट की तरह जुड़ता है।",
    27: "नियमित अध्ययन से ही बुद्धि तीव्र और आत्मविश्वास मजबूत होता है।",
    28: "अनुशासन ही वह शक्ति है जो साधारण विद्यार्थी को असाधारण बनाती है।",
    29: "अपने कर्तव्यों के प्रति निष्ठा ही आपको जीवन में सर्वोच्च मुकाम दिलाएगी।",
    30: "सफलता उन्हीं को मिलती है जो हर दिन अपनी उपस्थिति दर्ज कराते हैं।",
    31: "महीने का समापन! नए संकल्प के साथ आने वाले दिनों में शत-प्रतिशत उपस्थिति का लक्ष्य रखें।"
};
// 🏖️ 1 से 31 तारीख के अवकाश (LEAVE) विशेष प्रेरणादायी विचार
const leaveQuotes = {
    1: "स्वास्थ्य और विश्राम भी जीवन की ऊर्जा को बनाए रखने के लिए आवश्यक है।",
    2: "अवकाश के समय में भी स्वाध्याय की निरंतरता बनाए रखें।",
    3: "समय का सदुपयोग करते हुए छूटे हुए अध्ययन को शीघ्र पूर्ण करें।",
    4: "विश्राम के बाद नई ऊर्जा और उत्साह के साथ अध्ययन में पुनः जुटें।",
    5: "अनुशासन प्रिय विद्यार्थी अवकाश के दिनों में भी अपनी दिनचर्या संतुलित रखते हैं।",
    6: "घर पर रहकर भी अच्छी पुस्तकें पढ़ना ज्ञानवर्धन का श्रेष्ठ साधन है।",
    7: "अवकाश अवधि में भी स्वाध्याय को अपना सबसे अच्छा मित्र बनाएं।",
    8: "स्वास्थ्य लाभ लें और विद्यालय लौटने पर पूरी लगन से पढ़ाई करें।",
    9: "समय अनमोल है, अवकाश के दौरान भी कुछ नया सीखने का प्रयास करें।",
    10: "दैनिक अभ्यास से ही ज्ञान स्थिर रहता है, घर पर निरंतर दोहराव करें।",
    11: "विश्राम के उपरांत दोगुनी ऊर्जा से विद्यालय में अपनी उपस्थिति दर्ज कराएं।",
    12: "अवकाश का सदुपयोग स्वाध्याय और रचनात्मक कार्यों में करें।",
    13: "नियमित अध्ययन की आदत कभी न छोड़ें, चाहे विद्यालय में हों या घर पर।",
    14: "ज्ञानार्जन एक सतत प्रक्रिया है, जो घर पर भी निरंतर चलती रहनी चाहिए।",
    15: "शीघ्र स्वस्थ होकर विद्यालय आएं, आपकी शिक्षा हमारे लिए सर्वोपरि है।",
    16: "समय का उचित प्रबंधन ही विद्यार्थी को हमेशा आगे रखता है।",
    17: "अवकाश के उपरांत अपने सहपाठियों और शिक्षकों से संपर्क कर पाठ्य सामग्री पूरी करें।",
    18: "स्वास्थ्य की देखभाल पहली प्राथमिकता है, पूर्ण स्वस्थ होकर अध्ययन में जुटें।",
    19: "घर पर रहकर भी विद्यालय के गृहकार्य और पाठों की पुनरावृत्ति करें।",
    20: "संस्कार और अनुशासन अवकाश के दिनों में भी विद्यार्थी के आचरण में दिखते हैं।",
    21: "विश्राम के क्षणों में अपने लक्ष्यों और योजनाओं पर विचार करें।",
    22: "स्वाध्याय से आत्मविश्वास बढ़ता है, अवकाश का सदुपयोग करें।",
    23: "अपने स्वास्थ्य का ध्यान रखें और विद्यालय से निरंतर जुड़े रहें।",
    24: "समय का सम्मान करने वाला विद्यार्थी हर परिस्थिति में आगे रहता है।",
    25: "अवकाश के दिनों में की गई पढ़ाई परीक्षा के समय अत्यधिक सहायक सिद्ध होती है।",
    26: "शुभकामनाएं कि आप शीघ्र पुनः विद्यालय में अपनी उपस्थिति दर्ज कराएं।",
    27: "सकारात्मक सोच और स्वाध्याय से हर दिन को उपयोगी बनाएं।",
    28: "अनुशासन और नियमबद्धता विद्यार्थी जीवन का स्थायी आभूषण है।",
    29: "विश्राम पूर्ण कर पुनः नई उमंग के साथ अपनी कक्षा में लौटें।",
    30: "सदा सीखते रहने की ललक ही आपको सर्वश्रेष्ठ बनाती है।",
    31: "माह के अंत में नए संकल्प लें कि आगामी माह में शत-प्रतिशत उपस्थिति रहेगी।"
};
// 🛡️ सुरक्षित और साफ टेक्स्ट निष्कर्षण
function safePdfText(str, fallback = 'N/A') {
    if (!str || str === 'undefined' || str === 'null') return fallback;
    let clean = String(str).replace(/[^\x20-\x7E]/g, '').trim();
    return clean.length > 0 ? clean : fallback;
}

function calculateDynamicDue(student) {
    const monthlyFee = parseFloat(student.monthly_fee || student.tuition_fee || 0);
    const studentType = String(student.type || student.student_type || 'REGULAR').toUpperCase();
    const oldDue = parseFloat(student.old_due || 0);
    const totalPaid = parseFloat(student.total_paid || student.paid || 0);

    const currentMonth = new Date().getMonth() + 1;
    let elapsedMonths = (currentMonth >= 4) ? (currentMonth - 3) : (currentMonth + 9);

    let actualMonthlyFee = (studentType === 'RTE') ? 0 : monthlyFee;
    let expectedTillMonth = actualMonthlyFee * elapsedMonths;
    let currentDue = Math.max(0, expectedTillMonth - totalPaid);
    let grandTotalDue = currentDue + oldDue;

    return { elapsedMonths, expectedTillMonth, currentDue, oldDue, grandTotalDue };
}

const LID_MAP_FILE = path.join(__dirname, 'lid_phone_map.json');
let lidPhoneMap = {};

function loadLidPhoneMap() {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            lidPhoneMap = JSON.parse(fs.readFileSync(LID_MAP_FILE, 'utf8')) || {};
            console.log(`📇 LID मैपिंग कैश लोड हुआ (${Object.keys(lidPhoneMap).length} एंट्री)`);
        }
    } catch (e) {
        lidPhoneMap = {};
    }
}

function saveLidPhoneMapping(lidJid, phone) {
    try {
        if (!lidJid || !phone || lidPhoneMap[lidJid] === phone) return;
        lidPhoneMap[lidJid] = phone;
        fs.writeFileSync(LID_MAP_FILE, JSON.stringify(lidPhoneMap, null, 2));
        console.log(`📇 नई LID मैपिंग याद रखी: ${lidJid} → ${phone}`);
    } catch (e) {}
}

loadLidPhoneMap();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
// 🚀 Google Sheet Bridge Route
app.post('/sync-to-sheet', async (req, res) => {
    try {
        const payload = req.body || {};
        if (Object.keys(payload).length === 0) {
            return res.status(400).json({ status: "ERROR", message: "No data received" });
        }

        const response = await axios.post(GOOGLE_SCRIPT_URL, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 15000
        });

        return res.status(200).json({
            status: "SUCCESS",
            message: "Synced to Google Sheet via Railway",
            data: response.data
        });
    } catch (error) {
        console.error("❌ Sync Error:", error.message);
        return res.status(500).json({
            status: "ERROR",
            message: error.message
        });
    }
});
const messageCache = new Map();
const pausedChats = new Map(); // ⏸️ STOP किए गए नंबरों का अस्थायी लॉक
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const GROQ_STT_MODEL = (process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo").trim();
const GROQ_MODELS = [(process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim()]    
    .filter((m, i, a) => m && a.indexOf(m) === i);

const AI_GROUP_FILE = path.join(__dirname, 'ai_group_jid.json');
let aiGroupJid = (process.env.AI_GROUP_JID || '').trim();
try {
    if (!aiGroupJid && fs.existsSync(AI_GROUP_FILE)) {
        aiGroupJid = JSON.parse(fs.readFileSync(AI_GROUP_FILE, 'utf8')).jid || '';
    }
} catch (e) {}

const botSentIds = new Set();
let isAiBusy = false; // 🛡️ Anti-Loop & Anti-Race लॉक
let aiChatHistory = []; // केवल साफ़ टेक्स्ट हिस्ट्री

async function sendAiBoxReply(jid, payload) {
    if (!sock || !isBotReady) return;
    const sent = await sock.sendMessage(jid, payload);
    if (sent?.key?.id) {
        botSentIds.add(sent.key.id);
        if (botSentIds.size > 200) botSentIds.delete(botSentIds.values().next().value);
    }
}
const AI_SHARED_SECRET = (process.env.AI_SHARED_SECRET || '').trim();
const ADMIN_OWNER_PHONE = (process.env.ADMIN_OWNER_PHONE || '9792649799').replace(/[^0-9]/g, '').slice(-10);
const PHP_API_BASE_URL = (process.env.PHP_API_BASE_URL || 'https://jrdschool.online').replace(/\/+$/, '');

async function callSecurePhpApi(endpointFile, payloadObj) {
    if (!AI_SHARED_SECRET) throw new Error('AI_SHARED_SECRET set nahi hai');
    const rawBody = JSON.stringify(payloadObj || {});
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const sig = crypto.createHmac('sha256', AI_SHARED_SECRET)
        .update(`${ts}.${nonce}.${rawBody}`)
        .digest('hex');

    const res = await axios.post(`${PHP_API_BASE_URL}/${endpointFile}`, rawBody, {
        headers: {
            'Content-Type': 'application/json',
            'X-JRD-Timestamp': ts,
            'X-JRD-Nonce': nonce,
            'X-JRD-Signature': sig
        },
        timeout: 20000
    });
    return res.data;
}

async function isAuthorizedAdminAiMsg(jid, msg) {
    if (!aiGroupJid || jid !== aiGroupJid) return false;

    const m = msg.message || {};
    const ctx = m.extendedTextMessage?.contextInfo || m.audioMessage?.contextInfo || m.documentMessage?.contextInfo;
    if (ctx?.isForwarded || (ctx?.forwardingScore && ctx.forwardingScore > 0)) return false;

    if (msg.key.fromMe) return true;
    const senderPh = await extractGuardianPhone(jid, msg);
    return senderPh === ADMIN_OWNER_PHONE;
}
// ⏳ 2-STEP CONFIRMATION STATE (4 मिनट में ऑटो-एक्सपायर + One-Time Execution)
let pendingAiProposal = null;
const PROPOSAL_TTL_MS = 4 * 60 * 1000;

function setPendingProposal(proposal) {
    pendingAiProposal = {
        ...proposal,
        id: crypto.randomBytes(8).toString('hex'),
        expiresAt: Date.now() + PROPOSAL_TTL_MS,
        consumed: false
    };
    return pendingAiProposal;
}

function getActiveProposal() {
    if (!pendingAiProposal) return null;
    if (pendingAiProposal.consumed || Date.now() > pendingAiProposal.expiresAt) {
        pendingAiProposal = null;
        return null;
    }
    return pendingAiProposal;
}

function clearPendingProposal() {
    pendingAiProposal = null;
}
// 📄 GROUP PDF HOLDER (AI Command Center ग्रुप में आई PDF को अस्थायी होल्ड करने के लिए)
let pendingGroupPdf = null;
const GROUP_PDF_TTL_MS = 10 * 60 * 1000;

function setGroupPdf(pdfInfo) {
    if (pendingGroupPdf?.filePath) {
        try { if (fs.existsSync(pendingGroupPdf.filePath)) fs.unlinkSync(pendingGroupPdf.filePath); } catch (e) {}
    }
    pendingGroupPdf = {
        ...pdfInfo,
        expiresAt: Date.now() + GROUP_PDF_TTL_MS
    };
    return pendingGroupPdf;
}

function getGroupPdf() {
    if (!pendingGroupPdf) return null;
    if (Date.now() > pendingGroupPdf.expiresAt) {
        try { if (pendingGroupPdf.filePath && fs.existsSync(pendingGroupPdf.filePath)) fs.unlinkSync(pendingGroupPdf.filePath); } catch (e) {}
        pendingGroupPdf = null;
        return null;
    }
    return pendingGroupPdf;
}

function clearGroupPdf() {
    if (pendingGroupPdf?.filePath) {
        try { if (fs.existsSync(pendingGroupPdf.filePath)) fs.unlinkSync(pendingGroupPdf.filePath); } catch (e) {}
    }
    pendingGroupPdf = null;
}
async function executePendingProposal() {
    const prop = getActiveProposal();
    if (!prop) {
        return "⚠️ सर, अभी कोई सक्रिय पेंडिंग प्रस्ताव नहीं है (या 4 मिनट की समय-सीमा समाप्त हो चुकी है)। कृपया दोबारा आदेश दें।";
    }
    prop.consumed = true;
    clearPendingProposal();

    if (prop.kind === 'FEE_PAYMENT') {
        const res = await callSecurePhpApi('ai_gateway.php', {
            action: 'ai_fee_commit',
            sender_phone: ADMIN_OWNER_PHONE,
            engine_action: prop.engine_action,
            commit_payload: prop.commit_payload
        });
        if (res.status !== 'SUCCESS') {
            return `❌ फीस जमा करने में त्रुटि आई: ${res.message || 'Unknown error'}`;
        }
        return `✅ *फीस सफलतापूर्वक जमा (PAID) हो गई है!*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र:* *${res.student}* (${res.class_name})\n📅 *सत्र:* ${res.session}\n🧾 *रसीद नं.:* \`${res.receipt_id}\`\n💰 *जमा राशि:* *₹${res.paid_amount}/-*\n📋 *विवरण:*\n${res.details}\n━━━━━━━━━━━━━━━━━━━━━━━\n_MySQL, Google Sheet और गार्जियन रसीद अलर्ट अपडेट हो चुके हैं।_`;
    }
if (prop.kind === 'ATTENDANCE') {
        const res = await callSecurePhpApi('ai_gateway.php', {
            action: 'ai_attendance_commit',
            sender_phone: ADMIN_OWNER_PHONE,
            php_endpoint: prop.php_endpoint,
            commit_payload: prop.commit_payload
        });
        if (res.status !== 'SUCCESS') {
            return `❌ अटेंडेंस दर्ज करने में त्रुटि आई: ${res.message || 'Unknown error'}`;
        }
        return `✅ *अटेंडेंस सफलतापूर्वक दर्ज (SAVED) हो गई है!*\n━━━━━━━━━━━━━━━━━━━━━━━\n${res.message}\n_MySQL व Google Sheet अपडेट हो चुके हैं; गार्जियन/टीचर के नियमित SMS/नोटिफिकेशन अपने मौजूदा सिस्टम से चलेंगे।_`;
    }
    if (prop.kind === 'BROADCAST_PDF') {
        const recipients = Array.isArray(prop.recipients) ? prop.recipients : [];
        if (recipients.length === 0) {
            return "⚠️ कोई वैध प्राप्तकर्ता नंबर नहीं मिला।";
        }
        if (!prop.filePath || !fs.existsSync(prop.filePath)) {
            return "⚠️ PDF फ़ाइल अस्थायी रूप से उपलब्ध नहीं है (या एक्सपायर हो गई)। कृपया ग्रुप में दोबारा PDF भेजें।";
        }

        const pdfBuf = fs.readFileSync(prop.filePath);
        const fileName = prop.fileName || 'JRD_Document.pdf';
        const caption = prop.caption || `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📄 *${fileName}*`;

        let sentOk = 0;
        let sentFail = 0;

        for (const r of recipients) {
            const norm = normalizeIndianPhone(r.phone);
            if (!norm) { sentFail++; continue; }
            const targetJid = norm + '@s.whatsapp.net';
            try {
                if (sock && isBotReady) {
                    await sock.sendMessage(targetJid, {
                        document: pdfBuf,
                        mimetype: 'application/pdf',
                        fileName: fileName,
                        caption: caption
                    });
                    sentOk++;
                    if (recipients.length > 1) {
                        const delayMs = Math.floor(Math.random() * 2000) + 1500;
                        await new Promise(res => setTimeout(res, delayMs));
                    }
                } else {
                    sentFail++;
                }
            } catch (sendErr) {
                console.error(`❌ PDF send fail [${norm}]:`, sendErr.message);
                sentFail++;
            }
        }

        clearGroupPdf();
        return `📄 *PDF ब्रॉडकास्ट पूर्ण!*\n━━━━━━━━━━━━━━━━━━━━━━━\n📌 *फ़ाइल:* \`${fileName}\`\n🎯 *लक्ष्य:* ${prop.targetLabel}\n✅ *भेजे गए:* ${sentOk}\n❌ *विफल:* ${sentFail}`;
    }
    return "⚠️ अज्ञात प्रस्ताव प्रकार।";
}
const AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "search_student",
            description: "Search student profile, enrolment, father name, phone, paid fee and due fee by name or enrolment number.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Student name or enrolment number" },
                    class_name: { type: "string", description: "Optional class filter e.g. 8, 10, LKG" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_fee_defaulters",
            description: "Get list of top fee defaulters in a class or whole school.",
            parameters: {
                type: "object",
                properties: { class_name: { type: "string", description: "Optional class filter" } }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_teacher_attendance",
            description: "Check today's teacher attendance or a specific teacher's recent attendance/absence.",
            parameters: {
                type: "object",
                properties: { teacher_name: { type: "string", description: "Optional teacher name" } }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "send_fee_reminder_to_guardian",
            description: "Queue a WhatsApp fee reminder (Voice + QR) to a student's guardian. Only call when admin explicitly asks to send reminder.",
            parameters: {
                type: "object",
                properties: {
                    student_name: { type: "string" },
                    class_name: { type: "string" },
                    enrolment: { type: "string" },
                    phone: { type: "string" },
                    grand_due: { type: "number" }
                },
                required: ["student_name", "phone", "grand_due"]
            }
        }
    },
   {
        type: "function",
        function: {
            name: "get_bot_status",
            description: "Get live WhatsApp bot queue status, pending count and failed alerts.",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "get_teacher_salary",
            description: "Get teacher monthly attendance summary (present/absent/leave) and calculated salary for a specific teacher or all teachers.",
            parameters: {
                type: "object",
                properties: {
                    teacher_name: { type: "string", description: "Optional teacher name in English" },
                    month: { type: "number", description: "Optional month number 1-12" },
                    year: { type: "number", description: "Optional 4-digit year e.g. 2026" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_fee_collection",
            description: "Get total fee collected today, on a specific date, in a month, or full session along with recent receipts.",
            parameters: {
                type: "object",
                properties: {
                    mode: { type: "string", description: "'today', 'date', 'month', or 'session'" },
                    date: { type: "string", description: "Optional date in yyyy-MM-dd format" },
                    month: { type: "number", description: "Optional month 1-12" },
                    year: { type: "number", description: "Optional year" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_student_attendance",
            description: "Get today's student attendance summary, absent student list (whole school or class-wise), or a specific student's attendance history.",
            parameters: {
                type: "object",
                properties: {
                    student_name: { type: "string", description: "Optional student name in English or enrolment" },
                    class_name: { type: "string", description: "Optional class filter e.g. 8, 10, LKG" },
                    date: { type: "string", description: "Optional date yyyy-MM-dd" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_fee_structure",
            description: "Get approved school fee structure (monthly tuition, admission, exam fees) for a class or all classes.",
            parameters: {
                type: "object",
                properties: { class_name: { type: "string", description: "Optional class name e.g. 8, 10, LKG" } }
            }
        }
    },
  {
        type: "function",
        function: {
            name: "get_school_summary",
            description: "Get overall school dashboard: total students, class-wise student count, total pending dues, defaulters count, today's fee collection, and today's student attendance.",
            parameters: { type: "object", properties: {} }
        }
    }, // 👈 यहाँ कॉमा (,) ज़रूर लगाएँ
    {
        type: "function",
        function: {
            name: "prepare_fee_payment",
            description: "Check student fee structure, calculate exact month-wise/academic fee amounts and prior unpaid arrears, and create a pending confirmation preview. NEVER saves to database without user confirmation.",
            parameters: {
                type: "object",
                properties: {
                    student_query: { type: "string", description: "Student name in English or enrolment ID" },
                    class_name: { type: "string", description: "Optional class name e.g. 9, 10, LKG" },
                    months: {
                        type: "array",
                        items: { type: "string" },
                        description: "Requested month codes e.g. ['APR', 'MAY']"
                    },
                    academic_heads: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional academic fee keys: reg, adm, chg, exh, exa, prc, brd, adc"
                    },
                    lump_sum_amount: { type: "number", description: "Optional lump sum rupee amount if user gave amount instead of months" },
                    pay_mode: { type: "string", enum: ["SELECTIVE", "FIFO", "AUTO"], description: "SELECTIVE for specific months only (Pay Now), FIFO for oldest-first allocation (Z-Engine), AUTO to detect" }
                },
                required: ["student_query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "confirm_fee_payment",
            description: "Execute and save the already-prepared pending fee payment proposal ONLY after admin explicitly says yes/confirm.",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "prepare_attendance",
            description: "Prepare a preview for marking student attendance (individual or whole class with exceptions) or teacher attendance (PRESENT, ABSENT, IN, OUT). Never writes to DB before confirmation.",
            parameters: {
                type: "object",
                properties: {
                    target_type: { type: "string", enum: ["STUDENT", "TEACHER"] },
                    date: { type: "string", description: "Optional YYYY-MM-DD date, defaults to today" },
                    teacher_query: { type: "string", description: "Teacher name in English or teacher_id when target_type is TEACHER" },
                    status: { type: "string", description: "For TEACHER: PRESENT, ABSENT, IN, or OUT" },
                    class_name: { type: "string", description: "For STUDENT: class name e.g. 5, 9, LKG" },
                    default_status: { type: "string", description: "Optional 'P' or 'A' when marking entire class except specific students" },
                    entries: {
                        type: "array",
                        description: "List of specific students and their status ('P', 'A', or 'L')",
                        items: {
                            type: "object",
                            properties: {
                                query: { type: "string", description: "Student name in English or enrolment" },
                                status: { type: "string", enum: ["P", "A", "L"] }
                            },
                            required: ["query", "status"]
                        }
                    }
                },
                required: ["target_type"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "confirm_attendance",
            description: "Commit and save the already-prepared attendance proposal ONLY after admin says yes/confirm.",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "prepare_pdf_broadcast",
            description: "Prepare a preview to forward the recently uploaded group PDF to a specific class of students/guardians or all teachers. Never sends without confirmation.",
            parameters: {
                type: "object",
                properties: {
                    target_type: { type: "string", enum: ["STUDENTS", "TEACHERS"] },
                    class_name: { type: "string", description: "Class name when target_type is STUDENTS e.g. 6, 8, 10, LKG" },
                    caption: { type: "string", description: "Optional caption text to send with the PDF" }
                },
                required: ["target_type"]
            }
        }
    }
];
async function runAiTool(name, args) {
    try {
        if (name === 'search_student') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=student&token=${GAS_TOKEN}&q=${encodeURIComponent(args.query || '')}&cls=${encodeURIComponent(args.class_name || '')}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'get_fee_defaulters') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=defaulters&token=${GAS_TOKEN}&cls=${encodeURIComponent(args.class_name || '')}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'get_teacher_attendance') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=teacher_attendance&token=${GAS_TOKEN}&q=${encodeURIComponent(args.teacher_name || '')}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
       if (name === 'get_bot_status') {
            return { bot_ready: isBotReady, pending_queue: messageQueue.length, failed_count: failedAlertsLog.length };
        }
        if (name === 'get_teacher_salary') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=teacher_salary&token=${GAS_TOKEN}&q=${encodeURIComponent(args.teacher_name || '')}&month=${args.month || ''}&year=${args.year || ''}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'get_fee_collection') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=fee_collection&token=${GAS_TOKEN}&mode=${encodeURIComponent(args.mode || 'today')}&date=${encodeURIComponent(args.date || '')}&month=${args.month || ''}&year=${args.year || ''}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'get_student_attendance') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=student_attendance&token=${GAS_TOKEN}&q=${encodeURIComponent(args.student_name || '')}&cls=${encodeURIComponent(args.class_name || '')}&date=${encodeURIComponent(args.date || '')}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'get_fee_structure') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=fee_structure&token=${GAS_TOKEN}&cls=${encodeURIComponent(args.class_name || '')}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'get_school_summary') {
            const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=school_summary&token=${GAS_TOKEN}`;
            return (await axios.get(url, { timeout: 15000 })).data;
        }
        if (name === 'send_fee_reminder_to_guardian') {
            const dueAmt = Math.round(Number(args.grand_due) || 0);
            if (dueAmt <= 0) return { status: 'skipped', message: 'बकाया राशि 0 है, रिमाइंडर नहीं भेजा गया।' };
            const gPhone = normalizeIndianPhone(args.phone);
            if (!gPhone) return { status: 'error', message: 'अमान्य गार्जियन मोबाइल नंबर' };
            const payAssets = buildGuardianPaymentAssets({ enrolment: args.enrolment, name: args.student_name, grand_due: dueAmt });
            const remMsg = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *विद्यार्थी:* *${args.student_name}* (${args.class_name || ''})\n🆔 *Enrolment:* \`${args.enrolment || ''}\`\n🚩 *कुल बकाया राशि: ₹${dueAmt}/-*\n📲 *भुगतान लिंक:* ${payAssets ? payAssets.payLink : ''}`;
            messageQueue.push({
                number: gPhone, studentName: args.student_name, className: args.class_name || '',
                totalAmount: dueAmt, message: remMsg, qrUrl: payAssets ? payAssets.qrUrl : '', type: 'FEE_REMINDER_COMBO'
            });
            saveQueueToDisk();
            processQueue();
            return { status: 'queued', sent_to: gPhone, amount: dueAmt };
        }
    
        if (name === 'prepare_fee_payment') {
            const data = await callSecurePhpApi('ai_gateway.php', {
                action: 'ai_fee_preview',
                sender_phone: ADMIN_OWNER_PHONE,
                student_query: args.student_query || '',
                class_name: args.class_name || '',
                months: args.months || [],
                academic_heads: args.academic_heads || [],
                lump_sum_amount: args.lump_sum_amount || 0,
                pay_mode: args.pay_mode || 'AUTO'
            });
            if (data.status === 'SUCCESS' && data.total_amount > 0) {
                setPendingProposal({
                    kind: 'FEE_PAYMENT',
                    engine_action: data.engine_action,
                    commit_payload: data.commit_payload,
                    summary: data
                });
            }
            return data;
        }
        if (name === 'confirm_fee_payment') {
            const msgOut = await executePendingProposal();
            return { status: 'EXECUTED', confirmation_message: msgOut };
        }
       
        if (name === 'prepare_attendance') {
            const data = await callSecurePhpApi('ai_gateway.php', {
                action: 'ai_attendance_preview',
                sender_phone: ADMIN_OWNER_PHONE,
                target_type: args.target_type || 'STUDENT',
                date: args.date || '',
                teacher_query: args.teacher_query || '',
                status: args.status || '',
                class_name: args.class_name || '',
                default_status: args.default_status || '',
                entries: args.entries || []
            });
            if (data.status === 'SUCCESS' && data.commit_payload) {
                setPendingProposal({
                    kind: 'ATTENDANCE',
                    php_endpoint: data.php_endpoint,
                    commit_payload: data.commit_payload,
                    summary: data
                });
            }
            return data;
        }
        if (name === 'confirm_attendance') {
            const msgOut = await executePendingProposal();
            return { status: 'EXECUTED', confirmation_message: msgOut };
        }
        if (name === 'prepare_pdf_broadcast') {
            const pdfObj = getGroupPdf();
            if (!pdfObj) {
                return { status: 'NO_PDF', message: 'ग्रुप में अभी कोई हालिया PDF फ़ाइल नहीं मिली (या 10 मिनट पूरे हो गए)। कृपया पहले ग्रुप में PDF भेजें।' };
            }
            const tType = String(args.target_type || 'STUDENTS').toUpperCase();
            const clsName = String(args.class_name || '').trim();
            const qs = new URLSearchParams({
                action: 'get_broadcast_recipients',
                targetType: tType,
                className: clsName
            });
            const resp = await axios.get(`${PHP_API_BASE_URL}/api.php?${qs.toString()}`, { timeout: 15000 });
            const list = Array.isArray(resp.data?.data) ? resp.data.data : [];

            const uniqueMap = new Map();
            for (const row of list) {
                const nPh = normalizeIndianPhone(row.phone);
                if (nPh && !uniqueMap.has(nPh)) {
                    uniqueMap.set(nPh, { phone: nPh, name: row.name || '' });
                }
            }
            const cleanRecipients = Array.from(uniqueMap.values());
            const targetLabel = (tType === 'TEACHERS') ? 'सभी शिक्षक' : `कक्षा ${clsName || 'सभी'}`;

            if (cleanRecipients.length === 0) {
                return { status: 'EMPTY_RECIPIENTS', message: `${targetLabel} के लिए कोई वैध नंबर नहीं मिला।` };
            }

            setPendingProposal({
                kind: 'BROADCAST_PDF',
                filePath: pdfObj.filePath,
                fileName: pdfObj.fileName,
                caption: args.caption || '',
                targetLabel: targetLabel,
                recipients: cleanRecipients
            });

            return {
                status: 'SUCCESS',
                file_name: pdfObj.fileName,
                target_label: targetLabel,
                recipient_count: cleanRecipients.length
            };
        }
        return { status: 'error', message: 'Unknown tool' };
    } catch (toolErr) {
        console.error(`⚠️ AI Tool [${name}] Error:`, toolErr.message);
        return { status: 'error', message: toolErr.message };
    }
}

async function transcribeHindiAudioGroq(audioBase64) {
    const form = new FormData();
    const audioBuf = Buffer.from(audioBase64, 'base64');
    form.append('file', new Blob([audioBuf], { type: 'audio/ogg' }), 'voice.ogg');
    form.append('model', GROQ_STT_MODEL);
    form.append('language', 'hi');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Whisper transcription failed');
    return (data.text || '').trim();
}
async function getAvailableGroqModels_() {
    const list = [...GROQ_MODELS];
    try {
        const r = await axios.get('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
            timeout: 10000
        });
        const ids = (r.data?.data || [])
            .map(m => m.id)
            .filter(id => id && !/whisper|guard|audio|tts|embed|vision/i.test(id));
        for (const id of ids) {
            if (!list.includes(id)) list.push(id);
        }
    } catch (e) {}
    return list;
}
async function groqChatPost(messages) {
    let lastErr;
    const models = await getAvailableGroqModels_();
    for (const model of models) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                return await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model,
                    messages,
                    tools: AI_TOOLS,
                    tool_choice: 'auto',
                    temperature: 0.2
                }, {
                    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    timeout: 25000
                });
            } catch (e) {
                lastErr = e;
                const code = e.response?.status;
                if (code === 429 || code === 500 || code === 503) {
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                break;
            }
        }
    }
    throw lastErr;
}

async function askJrdAiBrain(userText, audioBase64 = null) {
    if (!GROQ_API_KEY) return "⚠️ सर्वर में GROQ_API_KEY सेट नहीं है। कृपया Environment Variables में GROQ_API_KEY जोड़ें।";

   try {
        let finalQuery = (userText || '').trim();
        if (audioBase64) {
            finalQuery = await transcribeHindiAudioGroq(audioBase64);
            console.log(`🎙️ Whisper सुना: "${finalQuery}"`);
            if (!finalQuery) return "⚠️ सर, आपकी आवाज़ साफ़ सुनाई नहीं दी, कृपया दोबारा बोलें।";
        }

        const systemMsg = {
            role: "system",
            content: "तुम J.R.D. Public School, Marui के Director (सर्वेश सर) के पर्सनल AI सेक्रेटरी हो। हमेशा संक्षिप्त, सटीक और आदरपूर्ण हिंदी में जवाब दो ('सर' कहकर संबोधित करो)। बिना डेटा देखे अंदाज़ा मत लगाओ — हमेशा दिए गए tools का इस्तेमाल करो। ज़रूरी नियम: Google Sheet में सभी छात्र और शिक्षक के नाम English में हैं, इसलिए जब भी सर हिंदी में कोई नाम बोलें या लिखें (जैसे 'रोहन वर्मा', 'अमरेश पटेल'), तो tool call में हमेशा उसका शुद्ध English (Roman) नाम भेजो (जैसे 'Rohan Verma', 'Amresh Patel')। class_name में सिर्फ़ नंबर या क्लास नाम भेजो (जैसे '8', '10', 'LKG' — 'Class' या 'कक्षा' मत जोड़ो)। अगर पूरे नाम से 0 रिकॉर्ड आए, तो दोबारा सिर्फ़ पहले नाम (First Name) से search_student ज़रूर चलाओ। फीस या अटेंडेंस दर्ज करने से पहले हमेशा prepare_fee_payment या prepare_attendance चलाओ और पूरा प्रीव्यू दिखाकर सर से कन्फ़र्मेशन माँगो — बिना सर के स्पष्ट कन्फ़र्मेशन के कभी confirm मत चलाओ।"
        };
        const workingMessages = [systemMsg, ...aiChatHistory, { role: "user", content: finalQuery }];

        for (let step = 0; step < 5; step++) {
            const res = await groqChatPost(workingMessages);
            const msg = res.data?.choices?.[0]?.message;
            if (!msg) break;
            workingMessages.push(msg);

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    const fnName = tc.function.name;
                    let fnArgs = {};
                    try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
                    const toolResult = await runAiTool(fnName, fnArgs);
                    workingMessages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: JSON.stringify(toolResult)
                    });
                }
                continue;
            }

            const replyText = (msg.content || '').trim() || "जी सर, कार्य पूर्ण हुआ।";
            aiChatHistory.push({ role: "user", content: finalQuery });
            aiChatHistory.push({ role: "assistant", content: replyText });
            if (aiChatHistory.length > 8) aiChatHistory = aiChatHistory.slice(-8);

            return replyText;
        }
        return "⚠️ अभी उत्तर तैयार करने में समस्या आई, कृपया दोबारा पूछें।";
    } catch (apiErr) {
        const detail = apiErr.response?.data?.error?.message || apiErr.message;
        console.error('❌ Groq API Error:', detail);
        return `⚠️ AI सेवा त्रुटि: ${detail}`;
    }
}
// =========================================================================
// 🛡️ JRD SECURE GUARDIAN AI ENGINE (5-LAYER ZERO-TRUST + LEAK-FREE)
// =========================================================================
const GUARDIAN_DAILY_LIMIT = 10; // हर गार्जियन नंबर पर रोज़ाना अधिकतम 10 AI सवाल
const guardianQuotaMap = new Map(); // key: phone -> { date, count }
const guardianBusySet = new Set();  // हर गार्जियन का अलग Anti-Race लॉक

const GUARDIAN_AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "get_my_child_fees",
            description: "Get live fee status, paid list, due list, and UPI payment link ONLY for the guardian's own registered child(ren).",
            parameters: {
                type: "object",
                properties: {
                    enrolment: { type: "string", description: "Optional enrolment of one of the guardian's registered children" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_my_child_attendance",
            description: "Get today's and recent attendance records ONLY for the guardian's own registered child(ren).",
            parameters: {
                type: "object",
                properties: {
                    enrolment: { type: "string", description: "Optional enrolment of one of the guardian's registered children" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_my_child_login",
            description: "Get student portal login ID (enrolment), password, and portal link ONLY for the guardian's own registered child(ren).",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "get_school_info",
            description: "Get J.R.D. Public School timings, address/location, admission info, and official portal/app link.",
            parameters: { type: "object", properties: {} }
        }
    }
];

function checkGuardianQuota_(phone) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const rec = guardianQuotaMap.get(phone);
    if (!rec || rec.date !== today) {
        guardianQuotaMap.set(phone, { date: today, count: 1 });
        return true;
    }
    if (rec.count >= GUARDIAN_DAILY_LIMIT) return false;
    rec.count += 1;
    return true;
}

// 🔒 Layer 1 & 2: Server-Side Whitelist Lock (AI कभी किसी दूसरे बच्चे का Enrolment पास नहीं कर सकता)
async function runGuardianSecureTool(name, args, senderPhone, registeredStudents) {
    try {
        const allowedList = Array.isArray(registeredStudents) ? registeredStudents : [];
        if (allowedList.length === 0 && name !== 'get_school_info') {
            return { status: 'error', message: 'आपके नंबर से कोई छात्र पंजीकृत नहीं है।' };
        }

        // केवल उसी के रजिस्टर्ड बच्चों में से फ़िल्टर करें (अगर AI कोई बाहर का enrolment भेजे तो इग्नोर होगा)
        const reqEnr = String(args?.enrolment || '').trim().toLowerCase();
        let targetStudents = allowedList;
        if (reqEnr) {
            const matched = allowedList.filter(s => String(s.enrolment || '').trim().toLowerCase() === reqEnr);
            if (matched.length > 0) targetStudents = matched;
        }

        if (name === 'get_my_child_fees') {
            const results = [];
            for (const st of targetStudents) {
                const rq = encodeURIComponent(st.enrolment || st.name || '');
                const r = await axios.get(`${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${rq}`, { timeout: 15000 });
                const d = r.data?.data;
                if (r.data?.status === 'success' && d) {
                    const payAssets = buildGuardianPaymentAssets(d);
                    results.push({
                        name: d.name,
                        class: d.class,
                        enrolment: d.enrolment,
                        total_paid: d.total_paid || 0,
                        current_due: d.current_due || 0,
                        old_due: d.old_due || 0,
                        grand_due: d.grand_due || 0,
                        due_list: d.due_list || '',
                        pay_link: payAssets ? payAssets.payLink : ''
                    });
                }
            }
            return { status: 'success', children_fees: results };
        }

        if (name === 'get_my_child_attendance') {
            const results = [];
            for (const st of targetStudents) {
                const enr = String(st.enrolment || '').trim();
                if (!enr) continue;
                const url = `${GOOGLE_SCRIPT_URL}?action=admin_ai_query&type=student_attendance&token=${GAS_TOKEN}&q=${encodeURIComponent(enr)}`;
                const r = await axios.get(url, { timeout: 15000 });
                results.push({
                    name: st.name,
                    class: st.class,
                    enrolment: enr,
                    summary: r.data?.summary || {},
                    recent_records: (r.data?.records || []).slice(0, 7)
                });
            }
            return { status: 'success', children_attendance: results };
        }

        if (name === 'get_my_child_login') {
            return {
                status: 'success',
                portal_url: 'https://jrdschool.online/studentdemo.html',
                logins: targetStudents.map(st => ({
                    name: st.name,
                    class: st.class,
                    login_id: st.enrolment,
                    password: st.password || 'jrd123'
                }))
            };
        }

        if (name === 'get_school_info') {
            return {
                school: 'J.R.D. Public School, मरुई, चोलापुर, वाराणसी (उ.प्र.) - 221208',
                timings: 'प्रातः 07:30 AM से दोपहर 01:30 PM तक (सोमवार से शनिवार)',
                portal: 'https://jrdschool.online/studentdemo.html',
                admission: 'सत्र 2026-27 के लिए प्रवेश प्रारंभ है। अधिक जानकारी हेतु विद्यालय कार्यालय में संपर्क करें।'
            };
        }

        return { status: 'error', message: 'अनुमति नहीं है।' };
    } catch (err) {
        console.error(`⚠️ Guardian Tool [${name}] Error:`, err.message);
        return { status: 'error', message: 'डेटा प्राप्त करने में अस्थायी समस्या आई।' };
    }
}

async function groqGuardianPost(messages) {
    let lastErr;
    const models = await getAvailableGroqModels_();
    for (const model of models) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                return await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model,
                    messages,
                    tools: GUARDIAN_AI_TOOLS,
                    tool_choice: 'auto',
                    temperature: 0.2
                }, {
                    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    timeout: 25000
                });
            } catch (e) {
                lastErr = e;
                const code = e.response?.status;
                if (code === 429 || code === 500 || code === 503) {
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                break;
            }
        }
    }
    throw lastErr;
}

async function askGuardianSecureAi(userText, audioBase64, senderPhone, registeredStudents) {
    if (!GROQ_API_KEY) return null;

    let finalQuery = (userText || '').trim();
    if (audioBase64) {
        finalQuery = await transcribeHindiAudioGroq(audioBase64);
        console.log(`🎙️ Guardian Voice [${senderPhone}]: "${finalQuery}"`);
        if (!finalQuery) return "🙏 आदरणीय अभिभावक जी, आपकी आवाज़ साफ़ सुनाई नहीं दी। कृपया दोबारा बोलें या *1* लिखकर भेजें।";
    }

    const allowedChildrenText = (registeredStudents || [])
        .map(s => `${s.name} (Class: ${s.class}, Enrolment: ${s.enrolment})`)
        .join(', ');

    const systemMsg = {
        role: "system",
        content: `तुम J.R.D. Public School, मरुई (वाराणसी) के आधिकारिक अभिभावक हेल्पडेस्क सहायक हो। विनम्र और संक्षिप्त हिंदी में जवाब दो ('आदरणीय अभिभावक जी' कहकर)।
कड़ा सुरक्षा नियम (ZERO-LEAK):
1. इस अभिभावक के नंबर से केवल ये विद्यार्थी जुड़े हैं: [${allowedChildrenText}]।
2. तुम केवल इन्हीं विद्यार्थियों की फीस, उपस्थिति, लॉगिन और स्कूल की सामान्य जानकारी दोगे।
3. यदि कोई किसी अन्य बच्चे, शिक्षक की सैलरी, स्कूल के कुल कलेक्शन या किसी बाहरी व्यक्ति की जानकारी मांगे, तो विनम्रता से मना कर दो कि सुरक्षा कारणों से केवल आपके पंजीकृत बच्चे की जानकारी ही दी जा सकती है।
4. बिना टूल चलाए कोई भी फीस या उपस्थिति का अंदाज़ा मत लगाओ।`
    };

    const workingMessages = [systemMsg, { role: "user", content: finalQuery }];

    for (let step = 0; step < 4; step++) {
        const res = await groqGuardianPost(workingMessages);
        const msg = res.data?.choices?.[0]?.message;
        if (!msg) break;
        workingMessages.push(msg);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
                const fnName = tc.function.name;
                let fnArgs = {};
                try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
                const toolResult = await runGuardianSecureTool(fnName, fnArgs, senderPhone, registeredStudents);
                workingMessages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify(toolResult)
                });
            }
            continue;
        }
        return (msg.content || '').trim() || "🙏 आदरणीय अभिभावक जी, मुख्य मेन्यू के लिए *Hi* लिखें।";
    }
    return "🙏 आदरणीय अभिभावक जी, अभी जानकारी निकालने में समस्या आई। कृपया *1* लिखकर भेजें।";
}
const PAUSE_DURATION_MS = 45 * 60 * 1000; // ⏱️ 45 मिनट
const APK_DOWNLOAD_URL = "https://github.com/आपका-यूजरनेम/रिपॉजिटरी/releases/download/v1.0/JRD_School.apk"; // 📲 असली APK लिंक यहाँ डालें
const msgRetryCounterCache = new Map();

let sock = null;
let currentQrCode = '';
let isBotReady = false;
let isConnecting = false;

function forceClearAuthFolder() {
    try {
        if (sock) {
            try { sock.ev.removeAllListeners(); } catch (e) {}
            try { sock.ws?.close(); } catch (e) {}
            sock = null;
        }
        if (fs.existsSync(AUTH_FOLDER)) {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            console.log('🧹 Auth Folder पूरी तरह से साफ़ कर दिया गया!');
        }
    } catch (e) {
        console.error('❌ Auth Folder साफ़ करने में त्रुटि:', e.message);
    }
}
// ☁️ Google Sheet (AuthBackup) se WhatsApp Session Auto-Restore & Auto-Backup
let authBackupTimer = null;

async function restoreAuthFromSheet() {
    try {
        if (fs.existsSync(path.join(AUTH_FOLDER, 'creds.json'))) return; // Local already hai
        console.log('☁️ Google Sheet se WhatsApp session restore kiya ja raha hai...');
        const url = `${GOOGLE_SCRIPT_URL}?action=get_auth_zip&key=SESSION_ZIP_DATA&token=${GAS_TOKEN}`;
        const res = await axios.get(url, { timeout: 15000 });
        if (res.data && res.data.status === 'success' && res.data.value) {
            const jsonStr = zlib.gunzipSync(Buffer.from(res.data.value, 'base64')).toString('utf8');
            const files = JSON.parse(jsonStr);
            if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER, { recursive: true });
            for (const [fname, content] of Object.entries(files)) {
                fs.writeFileSync(path.join(AUTH_FOLDER, fname), content, 'utf8');
            }
            console.log(`✅ Session restore ho gaya (${Object.keys(files).length} files) — QR scan ki zaroorat nahi!`);
        } else {
            console.log('ℹ️ Sheet me koi purana session backup nahi mila, naya QR banega.');
        }
    } catch (e) {
        console.error('⚠️ Session restore error:', e.message);
    }
}

function scheduleAuthBackup() {
    if (authBackupTimer) clearTimeout(authBackupTimer);
    authBackupTimer = setTimeout(async () => {
        try {
            if (!fs.existsSync(path.join(AUTH_FOLDER, 'creds.json'))) return;
            const files = {};
            for (const f of fs.readdirSync(AUTH_FOLDER)) {
                if (f === 'creds.json' || f.startsWith('app-state-sync-key-')) {
                    files[f] = fs.readFileSync(path.join(AUTH_FOLDER, f), 'utf8');
                }
            }
            let b64 = zlib.gzipSync(Buffer.from(JSON.stringify(files), 'utf8')).toString('base64');
            // Google Sheet 1 cell limit (50,000 chars) se bachav: agar bada ho to sirf creds.json save karo
            if (b64.length > 45000) {
                const onlyCreds = { 'creds.json': files['creds.json'] };
                b64 = zlib.gzipSync(Buffer.from(JSON.stringify(onlyCreds), 'utf8')).toString('base64');
            }
            await axios.post(GOOGLE_SCRIPT_URL, {
                action: 'save_auth_zip',
                token: process.env.API_TOKEN || '',
                key: 'SESSION_ZIP_DATA',
                value: b64
            }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
            console.log(`☁️ WhatsApp session Google Sheet me backup ho gaya (${b64.length} chars)`);
        } catch (e) {
            console.error('⚠️ Session backup error:', e.message);
        }
    }, 5000);
}
function pnJidToIndianMobile(candidate) {
    if (!candidate || typeof candidate !== 'string') return null;
    if (candidate.includes('@lid')) return null;

    let digits = candidate.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    if (digits.length === 12 && digits.startsWith('91')) {
        const p = digits.substring(2);
        if (/^[6-9]\d{9}$/.test(p)) return p;
    }
    if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;
    if (digits.length > 0 && digits.length <= 13) {
        const match = digits.match(/[6-9]\d{9}/);
        if (match && match[0]) return match[0];
    }
    return null;
}

async function extractGuardianPhone(jid, msg) {
    try {
        const directCandidates = [];
        if (msg?.key?.remoteJidAlt) directCandidates.push(msg.key.remoteJidAlt);
        if (msg?.key?.participantAlt) directCandidates.push(msg.key.participantAlt);
        if (msg?.key?.participant) directCandidates.push(msg.key.participant);
        if (msg?.key?.remoteJid) directCandidates.push(msg.key.remoteJid);
        if (jid) directCandidates.push(jid);

        const ctx = msg?.message?.extendedTextMessage?.contextInfo;
        if (ctx?.participant) directCandidates.push(ctx.participant);

        const lidCandidates = [...new Set(directCandidates.filter(c => typeof c === 'string' && c.includes('@lid')))];

        for (const candidate of directCandidates) {
            const phone = pnJidToIndianMobile(candidate);
            if (phone) {
                lidCandidates.forEach(lidJid => saveLidPhoneMapping(lidJid, phone));
                return phone;
            }
        }

        for (const lidJid of lidCandidates) {
            try {
                const resolved = await sock?.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
                const phone = pnJidToIndianMobile(resolved);
                if (phone) {
                    saveLidPhoneMapping(lidJid, phone);
                    return phone;
                }
            } catch (e) {}
        }

        for (const lidJid of lidCandidates) {
            if (lidPhoneMap[lidJid]) return lidPhoneMap[lidJid];
        }

        return null;
    } catch (e) {
        console.error('❌ extractGuardianPhone त्रुटि:', e.message);
        return null;
    }
}
// 🔎 नंबर डेटाबेस में चेक करो और पूरा डेटा वापस लो
async function checkRegisteredNumber(phone) {
    try {
        const url = `${GOOGLE_SCRIPT_URL}?action=check_user&phone=${phone}&token=${GAS_TOKEN}`;
        const r = await axios.get(url, { timeout: 12000 });
        console.log(`🔎 check_user [${phone}] ->`, JSON.stringify(r.data));
        if (r.data && (r.data.role === 'teacher' || r.data.role === 'guardian')) {
            return r.data; // isme role, teacher_id, password, post sab milega
        }
        if (r.data && r.data.status === 'unregistered_number') {
            return { role: 'unregistered' };
        }
        return { role: 'error' };
    } catch (e) {
        console.error('❌ check_user त्रुटि:', e.message);
        return { role: 'error' };
    }
}
// 📊 Teacher Current & Last Month Attendance Report Helper
async function sendTeacherAttendanceSummary(jid, phone, month, year, monthName) {
    try {
        await sendReply(jid, `⏳ माह *${monthName} (${year})* की उपस्थिति रिपोर्ट निकाली जा रही है, कृपया प्रतीक्षा करें...`);

        const url = `${GOOGLE_SCRIPT_URL}?action=get_teacher_attendance&phone=${phone}&month=${month}&year=${year}&token=${GAS_TOKEN}`;
        const res = await axios.get(url, { timeout: 15000 });
        const resData = res.data;

        if (!resData || resData.status !== 'success' || !resData.records || resData.records.length === 0) {
            await sendReply(jid, `⚠️ माह *${monthName} (${year})* के लिए कोई उपस्थिति रिकॉर्ड दर्ज नहीं मिला।`);
            return;
        }

        let report = `📊 *उपस्थिति रिपोर्ट: ${monthName} ${year}*\n`;
        report += `🏫 *J.R.D. Public School, Marui*\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `✅ कुल उपस्थित (PRESENT): ${resData.summary.present || 0} दिन\n`;
        report += `❌ कुल अनुपस्थित (ABSENT): ${resData.summary.absent || 0} दिन\n`;
        if (resData.summary.leave) {
            report += `🏖️ स्वीकृत अवकाश (LEAVE): ${resData.summary.leave} दिन\n`;
        }
        report += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        report += `📅 *दैनिक विवरण (Date-wise):*\n`;

        resData.records.forEach(r => {
            let icon = '✅';
            if (r.status.includes('ABSENT') || r.status === 'A') icon = '❌';
            else if (r.status.includes('LEAVE') || r.status === 'L') icon = '🏖️';

            report += `${icon} *${r.date}:* ${r.status} (आगमन: ${r.inTime || '--'} | प्रस्थान: ${r.outTime || '--'})\n`;
        });

        report += `\n🔗 *पोर्टल लिंक:* https://jrdschool.online/teacherlive.html`;

        await sendReply(jid, report);
    } catch (err) {
        console.error('Teacher attendance error:', err.message);
        await sendReply(jid, `⚠️ रिपोर्ट प्राप्त करने में तकनीकी समस्या आई है। कृपया थोड़ी देर बाद प्रयास करें।`);
    }
}
async function startBot(skipRestore = false) {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log('⚡ JRD VIP WhatsApp Bot प्रारंभ हो रहा है...');
        if (!skipRestore) await restoreAuthFromSheet();
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        let latestVersion = [2, 3000, 1017531287];
        try {
            const fetched = await fetchLatestBaileysVersion();
            if (fetched && fetched.version) latestVersion = fetched.version;
        } catch (e) {}

        sock = makeWASocket({
            auth: state,
            version: latestVersion,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            browser: Browsers.ubuntu('Chrome'),
            msgRetryCounterCache,
            retryRequestDelayMs: 1000,
            maxMsgRetryCount: 5,
            getMessage: async (key) => {
                if (messageCache.has(key.id)) return messageCache.get(key.id);
                return { conversation: 'JRD Public School' };
            }
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            scheduleAuthBackup();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQrCode = qr;
                isConnecting = false;
                console.log('✅ 🔥 नया QR Code तैयार है! /qr खोलें।');
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isBotReady = false;
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ सेशन समाप्त। नया सेशन बनाया जा रहा है...');
                    forceClearAuthFolder();
                    setTimeout(() => startBot(true), 1500);
                } else {
                    setTimeout(() => startBot(), 2500);
                }
            } else if (connection === 'open') {
                isConnecting = false;
                currentQrCode = '';
                isBotReady = true;
                console.log('\n=============================================');
                console.log(' 🎉 JRD VIP ERP Bot Active & Ready! ');
                console.log('=============================================\n');
                 if (messageQueue.length > 0) processQueue();   
            }
        });

       sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                await (async () => {
                    if (!msg.message) return;

            const jid = msg.key.remoteJid;
            if (!jid || jid === 'status@broadcast') return;
            if (botSentIds.has(msg.key.id)) return; // खुद के रिप्लाई पर लूप रोकें

            const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerText = rawText.toLowerCase();

           // 🤖 JRD AI COMMAND CENTER (Private Group: Text + Voice Note दोनों समझेगा)
            if (jid.endsWith('@g.us')) {
                if (msg.key.fromMe && lowerText === '!setup-ai') {
                    aiGroupJid = jid;
                    try { fs.writeFileSync(AI_GROUP_FILE, JSON.stringify({ jid })); } catch (e) {}
                    console.log('🤖 AI_GROUP_JID:', jid);
                    await sendAiBoxReply(jid, {
                        text: `🤖 *JRD AI COMMAND CENTER सक्रिय हो गया!*\n━━━━━━━━━━━━━━━━━━━━━━━\n📌 *स्थायी सेटअप (suga.app Variables में सेव करें):*\n\`AI_GROUP_JID\` = \`${jid}\`\n\nसर, अब आप यहाँ **बोलकर (Voice Note)** या **लिखकर** कुछ भी पूछ सकते हैं:\n• _"कक्षा 8 के रोहन की कितनी फीस बाकी है?"_\n• _"इसके गार्जियन को रिमाइंडर भेज दो"_\n• _"कक्षा 10 के सबसे बड़े बकायादार बताओ"_\n• _"आज कौन से टीचर आए हैं?"_\n• चैट मेमोरी रीसेट करने हेतु: \`!reset-ai\``
                    });
                    return;
                }

                if (!aiGroupJid || jid !== aiGroupJid) return;
                if (!(await isAuthorizedAdminAiMsg(jid, msg))) return;

                // 🛡️ Anti-Loop & Anti-Race सुरक्षा (बॉट खुद की वॉइस या टेक्स्ट पर कभी नहीं बोलेगा)
                if (isAiBusy || rawText.startsWith('🤖 *JRD AI') || rawText.startsWith('⚠️ AI')) return;

                if (lowerText === '!reset-ai') {
                    aiChatHistory = [];
                    await sendAiBoxReply(jid, { text: `🤖 *JRD AI:*\n✅ चैट मेमोरी साफ़ कर दी गई है सर। नया सवाल पूछें।` });
                    return;
                }

                // 👇 यहाँ से नया कन्फ़र्मेशन/कैंसिल ब्लॉक जोड़ें
                const confirmWords = ['हाँ', 'हां', 'कन्फर्म', 'कन्फ़र्म', 'confirm', 'yes', 'ok', 'कर दो', 'जमा कर दो', 'सेव कर दो'];
                const cancelWords  = ['नहीं', 'रद्द', 'कैंसिल', 'cancel', 'no', 'मत करो', 'रोको'];

                if (getActiveProposal() && confirmWords.includes(lowerText)) {
                    isAiBusy = true;
                    try {
                        const resultMsg = await executePendingProposal();
                        await sendAiBoxReply(jid, { text: `🤖 *JRD AI:*\n${resultMsg}` });
                    } finally {
                        setTimeout(() => { isAiBusy = false; }, 1500);
                    }
                    return;
                }

                if (getActiveProposal() && cancelWords.includes(lowerText)) {
                    clearPendingProposal();
                    await sendAiBoxReply(jid, { text: `🤖 *JRD AI:*\n❌ पेंडिंग प्रस्ताव रद्द कर दिया गया है सर। कोई एंट्री नहीं की गई।` });
                    return;
                }
                // 👆 यहाँ तक
const docMsg = msg.message.documentMessage;
                const isPdfDoc = !!(docMsg && (
                    String(docMsg.mimetype || '').toLowerCase().includes('pdf') ||
                    String(docMsg.fileName || '').toLowerCase().endsWith('.pdf')
                ));

                if (isPdfDoc) {
                    isAiBusy = true;
                    try {
                        const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                        if (!buf || buf.length < 100) throw new Error('PDF डाउनलोड नहीं हो सकी');

                        const safeName = (docMsg.fileName || `Document_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
                        const tmpPdfPath = path.join(os.tmpdir(), `jrd_grp_${Date.now()}_${safeName}`);
                        fs.writeFileSync(tmpPdfPath, buf);

                        setGroupPdf({
                            filePath: tmpPdfPath,
                            fileName: safeName,
                            sizeKb: Math.max(1, Math.round(buf.length / 1024))
                        });

                        const docCaption = String(docMsg.caption || '').trim();
                        if (docCaption) {
                            const aiReply = await askJrdAiBrain(`${docCaption} (Note: PDF file '${safeName}' is now staged and ready; use prepare_pdf_broadcast to preview recipients before asking confirmation.)`, null);
                            await sendAiBoxReply(jid, { text: `🤖 *JRD AI:*\n${aiReply}` });
                        } else {
                            await sendAiBoxReply(jid, {
                                text: `🤖 *JRD AI:*\n📄 PDF फ़ाइल *\`${safeName}\`* (${Math.max(1, Math.round(buf.length / 1024))} KB) सेव कर ली गई है सर।\nबताइए यह किस **क्लास** या **टीचर्स** को भेजनी है?`
                            });
                        }
                    } catch (pdfErr) {
                        console.error('❌ Group PDF Error:', pdfErr.message);
                        await sendAiBoxReply(jid, { text: `⚠️ PDF सेव करने में त्रुटि: ${pdfErr.message}` });
                    } finally {
                        setTimeout(() => { isAiBusy = false; }, 1500);
                    }
                    return;
                }
                const isAudio = !!msg.message.audioMessage;
                if (!rawText && !isAudio) return;

                isAiBusy = true;
                try {
                    try { await sock.sendPresenceUpdate('composing', jid); } catch (e) {}
                    let audioBase64 = null;
                    if (isAudio) {
                        const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                        if (!buf || buf.length < 100) throw new Error('वॉइस नोट डाउनलोड नहीं हो सका');
                        audioBase64 = buf.toString('base64');
                    }

                    const aiReply = await askJrdAiBrain(rawText, audioBase64);
                    try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}
                    await sendAiBoxReply(jid, { text: `🤖 *JRD AI:*\n${aiReply}` });

                    const voiceBuf = await generateHindiVoiceNote(aiReply);
                    if (voiceBuf) {
                        await new Promise(res => setTimeout(res, 1000));
                        await sendAiBoxReply(jid, { audio: voiceBuf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }
                } catch (aiErr) {
                    console.error('❌ AI Group Handler Error:', aiErr.message);
                    await sendAiBoxReply(jid, { text: `⚠️ AI त्रुटि: ${aiErr.message}` });
                } finally {
                    setTimeout(() => { isAiBusy = false; }, 2000);
                }
                return;
            }
            // 🛑 1. MANAGER STOP / START CONTROL (केवल आपके स्वयं भेजने पर - रजिस्टर्ड व अनरजिस्टर्ड सभी पर लागू)
            if (msg.key.fromMe) {
                if (lowerText === 'stop') {
                    pausedChats.set(jid, Date.now() + PAUSE_DURATION_MS);
                    await sendReply(jid, `⏸️ *ऑटो-हेल्पलाइन सेवा 45 मिनट के लिए रोकी गई है।*\nअब आप सीधे विद्यालय प्रबंधन से संवाद कर सकते हैं।\n_(पुनः चालू करने हेतु *START* लिखें)_`);
                    return;
                }
                if (lowerText === 'start') {
                    if (pausedChats.has(jid)) {
                        pausedChats.delete(jid);
                        await sendReply(jid, `▶️ *ऑटो-हेल्पलाइन सेवा पुनः सक्रिय कर दी गई है।*\nमुख्य मेन्यू देखने हेतु *Hi* लिखें।`);
                    }
                    return;
                }
                return; // आपके किसी भी सामान्य चैट मैसेज पर बॉट नहीं बोलेगा
            }

            // ⏸️ 2. यदि यह चैट STOP मोड में है, तो चैट/मेन्यू रिप्लाई बंद रखें (ज़रूरी स्कूल अलर्ट चलते रहेंगे)
            if (pausedChats.has(jid)) {
                const expiryTime = pausedChats.get(jid);
                if (Date.now() < expiryTime) {
                    return; // अभी 45 मिनट पूरे नहीं हुए हैं, चैट मेन्यू चुप रहेगा
                } else {
                    pausedChats.delete(jid); // 45 मिनट पूरे होते ही अपने आप सामान्य हो जाएगा
                }
            }

            try { await sock.readMessages([msg.key]); } catch (e) {}

            const senderPhone = await extractGuardianPhone(jid, msg);
            console.log(`📱 संदेश प्राप्त | नंबर: [${senderPhone || 'अज्ञात'}] | पाठ: "${rawText}"`);

            if (!senderPhone) {
                const possiblePhone = rawText.replace(/[^0-9]/g, '');

                if (possiblePhone.length === 10 && /^[6-9]\d{9}$/.test(possiblePhone)) {
                    try {
                        const checkRoleData = await checkRegisteredNumber(possiblePhone);
                        const checkRole = checkRoleData.role;
                        if (checkRole === 'teacher' || checkRole === 'guardian') {
                            saveLidPhoneMapping(jid, possiblePhone);
                            await sendReply(jid, `🙏 *नमस्ते!*\n\nआपका मोबाइल नंबर (*${possiblePhone}*) सफलतापूर्वक पंजीकृत कर लिया गया है।\n\nकृपया मुख्य मेन्यू देखने हेतु **Hi** लिखकर भेजें।`);
                        } else if (checkRole === 'unregistered') {
                            await sendReply(jid, `🙏 *आदरणीय,*\n\nयह मोबाइल नंबर (*${possiblePhone}*) विद्यालय रिकॉर्ड में पंजीकृत नहीं है।\n\nकृपया सही पंजीकृत नंबर भेजें अथवा विद्यालय कार्यालय में संपर्क करें।`);
                        } else {
                            await sendReply(jid, `⚠️ सत्यापन प्रक्रिया में तकनीकी समस्या आई है। कृपया थोड़ी देर बाद पुनः प्रयास करें।`);
                        }
                    } catch (e) {
                        await sendReply(jid, `⚠️ सत्यापन प्रक्रिया में त्रुटि हुई। कृपया थोड़ी देर बाद प्रयास करें।`);
                    }
                    return;
                }

                await sendReply(jid, `🙏 *नमस्ते!*\n\nJ.R.D. Public School की डिजिटल हेल्पलाइन में आपका स्वागत है।\n\nसुरक्षा कारणों से आपका नंबर स्वतः पहचाना नहीं जा सका। कृपया अपना **10 अंकों का पंजीकृत मोबाइल नंबर** यहाँ टाइप करके भेजें (उदा: 9792649799)।`);
                return;
            }

            // 🎯 1. SABSE PEHLE DATABASE ROLE CHECK KAREIN
            const userData = await checkRegisteredNumber(senderPhone);
            const role = userData.role;

            if (role === 'error') {
                await sendReply(jid, `⚠️ अभी सत्यापन में समस्या आ रही है। कृपया थोड़ी देर बाद पुनः प्रयास करें।`);
                return;
            }

            // 🚫 2. UNREGISTERED NUMBER
            if (role === 'unregistered') {
                if (rawText === '1') {
                    await sendReply(jid, `📝 *नया प्रवेश प्रारंभ (सत्र 2026-27)*\n🏫 *J.R.D. Public School, मरुई, वाराणसी*\n━━━━━━━━━━━━━━━━━━━━━━━\n• संस्कारयुक्त एवं उच्च स्तरीय डिजिटल शिक्षा\n• कंप्यूटर लैब एवं योग्य शिक्षक वृन्द\n\n📞 *प्रवेश हेतु विद्यालय कार्यालय में संपर्क करें।*`);
                    return;
                }
                if (rawText === '2') {
                    await sendReply(jid, `⏰ *स्कूल समय सारणी*\n🏫 *J.R.D. Public School*\n━━━━━━━━━━━━━━━━━━━━━━━\n⏱ *समय:* प्रातः 07:30 AM से दोपहर 01:30 PM तक\n📅 *दिन:* सोमवार से शनिवार\n\n_नोट: कृपया बच्चों को समय से पूर्ण गणवेश (Uniform) में भेजें।_`);
                    return;
                }
                if (rawText === '3') {
                    await sendReply(jid, `👑 *प्रबंधकीय संदेश*\n🏫 *J.R.D. Public School Management*\n━━━━━━━━━━━━━━━━━━━━━━━\n✨ *संस्थापक:* श्री बंशगोपाल वर्मा जी\n✨ *प्रबंधक:* डॉ. बंशलाल जी\n\n> *"हम प्रत्येक बच्चे के सर्वांगीण विकास एवं उज्ज्वल भविष्य के लिए समर्पित हैं।"*`);
                    return;
                }
                if (rawText === '4') {
                    await sendReply(jid, `📍 *विद्यालय लोकेशन:*\nJ.R.D. Public School, ग्राम व पोस्ट - मरुई, चोलापुर, जिला - वाराणसी (उ.प्र.) - 221208\n\n🗺 *गूगल मैप्स पर ढूँढें:*\nGoogle Maps पर खोजें: *JRD Public School Marui Varanasi*`);
                    return;
                }

                await sendReply(jid, `🏫 *J.R.D. PUBLIC SCHOOL, मरुई (वाराणसी)*\n━━━━━━━━━━━━━━━━━━━━━━━\n🙏 डिजिटल हेल्पलाइन में आपका स्वागत है!\n\nआपका मोबाइल नंबर (*${senderPhone}*) विद्यालय रिकॉर्ड में पंजीकृत नहीं है।\nकृपया विद्यालय कार्यालय में संपर्क करें।\n\nनए प्रवेश हेतु विकल्प संख्या भेजें:\n1️⃣ प्रवेश जानकारी\n2️⃣ स्कूल टाइमिंग\n3️⃣ प्रबंधक संदेश\n4️⃣ लोकेशन`);
                return;
            }

            // 👨‍🏫 3. TEACHER SECTION (Attendance 1/2 + ID Password 3)
            if (role === 'teacher') {
                const now = new Date();
                const currentMonth = now.getMonth() + 1;
                const currentYear = now.getFullYear();

                let lastMonth = currentMonth - 1;
                let lastYear = currentYear;
                if (lastMonth === 0) {
                    lastMonth = 12;
                    lastYear = currentYear - 1;
                }

                const monthNames = [
                    "", "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
                    "जुलाई", "अगस्त", "सितम्बर", "अक्टूबर", "नवम्बर", "दिसम्बर"
                ];

                if (rawText === '1') {
                    await sendTeacherAttendanceSummary(jid, senderPhone, currentMonth, currentYear, monthNames[currentMonth]);
                    return;
                }

                if (rawText === '2') {
                    await sendTeacherAttendanceSummary(jid, senderPhone, lastMonth, lastYear, monthNames[lastMonth]);
                    return;
                }

                if (rawText === '3' || lowerText === 'id' || lowerText === 'password' || lowerText === 'pass') {
                    const tName = userData.name || userData.teacher_name || 'शिक्षक';
                    const tId = userData.teacher_id || userData.username || userData.id || 'N/A';
                    const tPass = userData.password || userData.pass || 'N/A';
                    const tPost = userData.designation || userData.post || userData.subject || 'अध्यापक';

                    const credMessage = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                        `🔐 *आधिकारिक शिक्षक लॉगिन विवरण (LOGIN CREDENTIALS)*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👤 *शिक्षक का नाम:* ${tName}\n` +
                        `💼 *पद (Designation):* ${tPost}\n` +
                        `🆔 *Login ID / Username:* \`${tId}\`\n` +
                        `🔑 *Password:* \`${tPass}\`\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `🌐 *लॉगिन पोर्टल लिंक:*\nhttps://jrdschool.online/teacherlive.html\n\n` +
                        `⚠️ _सुरक्षा चेतावनी: अपना पासवर्ड किसी के साथ साझा न करें।_`;

                    await sendReply(jid, credMessage);
                    return;
                }

                const teacherMenu = `🏫 *J.R.D. PUBLIC SCHOOL (शिक्षक डेस्क)*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🙏 नमस्ते *${userData.name || 'शिक्षक'}* जी! आपका स्वागत है।\n\n` +
                    `🔗 *शिक्षक लाइव पोर्टल:*\nhttps://jrdschool.online/teacherlive.html\n\n` +
                    `📋 *सुविधा हेतु विकल्प चुनें:*\n` +
                    `1️⃣ *चालू माह (${monthNames[currentMonth]}) की उपस्थिति*\n` +
                    `2️⃣ *पिछले माह (${monthNames[lastMonth]}) की उपस्थिति*\n` +
                    `3️⃣ *मेरी लॉगिन ID एवं Password देखें*\n\n` +
                    `👉 _कृपया केवल **1**, **2** या **3** लिखकर भेजें।_`;

                await sendReply(jid, teacherMenu);
                return;
            }

            // 👨‍👩‍👧 4. GUARDIAN SECTION (Fully Dynamic Singular/Plural Menu + Fees + Credentials + #Name/Enroll + APK)
            if (role === 'guardian') {
                const registeredStudents = Array.isArray(userData.students) ? userData.students : [];
                const isMultiChild = registeredStudents.length > 1;

                // विकल्प 1: बच्चे/सभी बच्चों की प्रोफाइल एवं फीस बकाया देखें
                if (rawText === '1' || lowerText === 'fee' || lowerText === 'fees' || lowerText === 'profile') {
                    try {
                        await sendReply(jid, `⏳ आपके पंजीकृत नंबर से जुड़े ${isMultiChild ? 'सभी विद्यार्थियों' : 'विद्यार्थी'} का विवरण निकाला जा रहा है, कृपया प्रतीक्षा करें...`);
                        // 🎯 हर पंजीकृत बच्चे का कार्ड अलग-अलग enrolment से निकालो (Apps Script 'ALL' पर निर्भर नहीं)
                        if (registeredStudents.length > 0) {
                            let sentAny = false;
                            for (const rs of registeredStudents) {
                                try {
                                    const rq = encodeURIComponent(rs.enrolment || rs.name || '');
                                    const r1 = await axios.get(`${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${rq}`, { timeout: 15000 });
                                    const d1 = r1.data || {};
                                    if (d1.status === 'success' && d1.data) {
                                        await sendStudentProfileCard(jid, d1.data);
                                        sentAny = true;
                                    }
                                } catch (e1) { console.error('Child card fetch error:', e1.message); }
                            }
                            if (sentAny) return;
                        }
                        const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=ALL`;
                        const response = await axios.get(apiUrl, { timeout: 15000 });
                        const resData = response.data || {};

                        if (resData.status === 'success') {
                            const studentsList = Array.isArray(resData.students) ? resData.students : (resData.data ? [resData.data] : []);
                            if (studentsList.length > 0) {
                                for (const st of studentsList) {
                                    await sendStudentProfileCard(jid, st);
                                }
                                return;
                            }
                        }
                        await sendReply(jid, `⚠️ आपके मोबाइल नंबर (*${senderPhone}*) से वर्तमान सत्र (2026-27) में कोई छात्र प्रोफाइल नहीं मिली। कृपया विद्यालय कार्यालय में संपर्क करें।`);
                    } catch (err) {
                        console.error('Guardian Profile Fetch Error:', err.message);
                        await sendReply(jid, `⚠️ विवरण प्राप्त करने में तकनीकी समस्या आई है। कृपया थोड़ी देर बाद प्रयास करें।`);
                    }
                    return;
                }

                // विकल्प 2: बच्चे/सभी बच्चों की लॉगिन ID एवं Password देखें
                if (rawText === '2' || lowerText === 'id' || lowerText === 'password' || lowerText === 'pass' || lowerText === 'login') {
                    try {
                        let studentsList = registeredStudents;
                        if (studentsList.length === 0) {
                            const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=ALL`;
                            const response = await axios.get(apiUrl, { timeout: 15000 });
                            const resData = response.data || {};
                            if (resData.status === 'success') {
                                studentsList = Array.isArray(resData.students) ? resData.students : (resData.data ? [resData.data] : []);
                            }
                        }

                        if (studentsList.length > 0) {
                            let credMsg = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                                `🔐 *आधिकारिक छात्र लॉगिन विवरण (STUDENT LOGIN)*\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━\n`;

                            studentsList.forEach((st, idx) => {
                                const sName = st.name || st.student_name || 'विद्यार्थी';
                                const sClass = st.class || st.class_name || 'N/A';
                                const sId = st.enrolment || st.enroll || 'N/A';
                                const sPass = st.password || st.student_pass || 'jrd123';
                                credMsg += `👤 *विद्यार्थी ${studentsList.length > 1 ? (idx + 1) : ''}:* *${sName}*\n` +
                                    `🏫 *कक्षा:* ${sClass}\n` +
                                    `🆔 *Login ID (Enrolment):* \`${sId}\`\n` +
                                    `🔑 *Password:* \`${sPass}\`\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━━\n`;
                            });

                            credMsg += `🌐 *छात्र लॉगिन पोर्टल लिंक:*\nhttps://jrdschool.online/studentdemo.html\n\n` +
                                `⚠️ _सुरक्षा चेतावनी: कृपया अपनी लॉगिन जानकारी सुरक्षित रखें।_`;

                            await sendReply(jid, credMsg);
                        } else {
                            await sendReply(jid, `⚠️ आपके नंबर से जुड़ा कोई छात्र लॉगिन रिकॉर्ड नहीं मिला। कृपया विद्यालय कार्यालय में संपर्क करें।`);
                        }
                    } catch (err) {
                        console.error('Student Login Fetch Error:', err.message);
                        await sendReply(jid, `⚠️ लॉगिन विवरण प्राप्त करने में समस्या आई है। कृपया पुनः प्रयास करें।`);
                    }
                    return;
                }

                // विकल्प 3: स्कूल टाइमिंग
                if (rawText === '3') {
                    await sendReply(jid, `⏰ *स्कूल समय सारणी*\n🏫 *J.R.D. Public School*\n━━━━━━━━━━━━━━━━━━━━━━━\n⏱ *समय:* प्रातः 07:30 AM से दोपहर 01:30 PM तक\n📅 *दिन:* सोमवार से शनिवार\n\n_नोट: कृपया बच्चों को समय से पूर्ण गणवेश (Uniform) में भेजें।_`);
                    return;
                }

                // विकल्प 4: नया प्रवेश एवं प्रबंधक संदेश
                if (rawText === '4') {
                    await sendReply(jid, `📝 *नया प्रवेश प्रारंभ (सत्र 2026-27)*\n🏫 *J.R.D. Public School, मरुई, वाराणसी*\n━━━━━━━━━━━━━━━━━━━━━━━\n• संस्कारयुक्त एवं उच्च स्तरीय डिजिटल शिक्षा\n• कंप्यूटर लैब एवं योग्य शिक्षक वृन्द\n\n👑 *प्रबंधकीय संदेश:*\n✨ *संस्थापक:* श्री बंशगोपाल वर्मा जी\n✨ *प्रबंधक:* डॉ. बंशलाल जी\n> *"हम प्रत्येक बच्चे के सर्वांगीण विकास एवं उज्ज्वल भविष्य के लिए समर्पित हैं।"*\n\n📞 *प्रवेश हेतु विद्यालय कार्यालय में संपर्क करें।*`);
                    return;
                }

                // विकल्प 5: विद्यालय लोकेशन
                if (rawText === '5') {
                    await sendReply(jid, `📍 *विद्यालय लोकेशन:*\nJ.R.D. Public School, ग्राम व पोस्ट - मरुई, चोलापुर, जिला - वाराणसी (उ.प्र.) - 221208\n\n🗺 *गूगल मैप्स पर ढूँढें:*\nGoogle Maps पर खोजें: *JRD Public School Marui Varanasi*`);
                    return;
                }

                // विकल्प 6: स्कूल मोबाइल ऐप (Android APK) डिलीवरी इंजन
                if (rawText === '6' || lowerText === 'app' || lowerText === 'apk') {
                    try {
                        await sendReply(jid, `📲 *J.R.D. Public School Official App* भेजा जा रहा है, कृपया प्रतीक्षा करें...`);
                        const localApkPath = path.join(__dirname, 'JRD_School.apk');
                        const apkCaption = `📱 *J.R.D. PUBLIC SCHOOL — OFFICIAL ANDROID APP*\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `✅ इस ऐप के माध्यम से आप घर बैठे बच्चे की लाइव उपस्थिति, फीस बकाया, डिजिटल रसीद और परीक्षा परिणाम देख सकते हैं।\n\n` +
                            `🌐 *वेब पोर्टल:* https://jrdschool.online/studentdemo.html\n` +
                            `_(इंस्टॉल करने हेतु फाइल पर क्लिक करें और 'Install from Unknown Sources' की अनुमति दें)_`;

                        if (fs.existsSync(localApkPath)) {
                            await sock.sendMessage(jid, {
                                document: fs.readFileSync(localApkPath),
                                mimetype: 'application/vnd.android.package-archive',
                                fileName: 'JRD_Public_School.apk',
                                caption: apkCaption
                            });
                        } else if (APK_DOWNLOAD_URL && APK_DOWNLOAD_URL.startsWith('http') && !APK_DOWNLOAD_URL.includes('आपका-यूजरनेम')) {
                            await sock.sendMessage(jid, {
                                document: { url: APK_DOWNLOAD_URL },
                                mimetype: 'application/vnd.android.package-archive',
                                fileName: 'JRD_Public_School.apk',
                                caption: apkCaption
                            });
                        } else {
                            await sendReply(jid, `📲 *J.R.D. Public School App & Portal*\n\n🌐 *सीधा पोर्टल लिंक:* https://jrdschool.online/studentdemo.html\n_(ऐप फ़ाइल सर्वर पर अपडेट हो रही है, तब तक ऊपर दिए गए लिंक से सभी सेवाएँ उपयोग करें)_`);
                        }
                    } catch (apkErr) {
                        console.error('❌ APK Send Error:', apkErr.message);
                        await sendReply(jid, `⚠️ ऐप फ़ाइल भेजने में तकनीकी समस्या आई। कृपया सीधा पोर्टल लिंक उपयोग करें:\nhttps://jrdschool.online/studentdemo.html`);
                    }
                    return;
                }

                // 🔍 किसी एक खास बच्चे का विवरण देखना (#नाम या Enrolment No. द्वारा)
                const isGreeting = ['hi', 'hello', 'hii', 'नमस्ते', 'प्रणाम', 'menu', 'start', 'good morning', 'suprabhat', 'जय हिंद', 'ok'].includes(lowerText);
                const isExactEnrollMatch = lowerText.length > 0 && registeredStudents.some(st => String(st.enrolment || '').trim().toLowerCase() === lowerText);

                if (!isGreeting && (rawText.startsWith('#') || isExactEnrollMatch)) {
                    const searchQuery = rawText.replace(/#/g, '').trim();
                    try {
                        const apiUrl = `${GOOGLE_SCRIPT_URL}?action=get_student&phone=${senderPhone}&query=${encodeURIComponent(searchQuery)}`;
                        const response = await axios.get(apiUrl, { timeout: 12000 });
                        const resData = response.data || {};
                        if (resData.status === 'success' && resData.data) {
                            await sendStudentProfileCard(jid, resData.data);
                        } else {
                            await sendReply(jid, `❌ *रिकॉर्ड नहीं मिला*\n\nछात्र विवरण *"${searchQuery}"* आपके पंजीकृत मोबाइल नंबर से जुड़ा नहीं मिला।\n\n${isMultiChild ? 'सभी बच्चों' : 'बच्चे'} की जानकारी देखने के लिए केवल **1** लिखकर भेजें।`);
                        }
                    } catch (e) {}
                    return;
                }
           // 🤖 SECURE GUARDIAN AI (Voice Note + Natural Hindi/English Questions)
                const isGuardianAudio = !!msg.message.audioMessage;
                const isNoiseMsg = ['ok', 'okay', 'thanks', 'thank you', 'thnx', 'धन्यवाद', 'शुक्रिया', 'ठीक है', 'जी', 'hmm', '👍', '🙏'].includes(lowerText);
                const shouldRunGuardianAi = GROQ_API_KEY && !isGreeting && !isNoiseMsg && (isGuardianAudio || rawText.length >= 4);

                if (shouldRunGuardianAi) {
                    if (guardianBusySet.has(jid)) return;
                    if (!checkGuardianQuota_(senderPhone)) {
                        await sendReply(jid, `🙏 आदरणीय अभिभावक जी, आज के स्मार्ट AI सवालों की सीमा पूरी हो गई है।\nकृपया सीधे मेन्यू विकल्प **1** (फीस), **2** (लॉगिन ID) या **3-6** का उपयोग करें।`);
                        return;
                    }

                    guardianBusySet.add(jid);
                    try {
                        try { await sock.sendPresenceUpdate('composing', jid); } catch (e) {}
                        let gAudioBase64 = null;
                        if (isGuardianAudio) {
                            const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                            if (!buf || buf.length < 100) throw new Error('Audio download failed');
                            gAudioBase64 = buf.toString('base64');
                        }

                        const gReply = await askGuardianSecureAi(rawText, gAudioBase64, senderPhone, registeredStudents);
                        try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}

                        if (gReply) {
                            await sendReply(jid, gReply);
                            // 🎙️ अगर गार्जियन ने वॉइस नोट भेजा है, तो Swara की हिंदी वॉइस में भी जवाब दें
                            if (isGuardianAudio) {
                                const vBuf = await generateHindiVoiceNote(gReply);
                                if (vBuf) {
                                    await new Promise(r => setTimeout(r, 1000));
                                    await sock.sendMessage(jid, { audio: vBuf, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                                }
                            }
                            return;
                        }
                    } catch (gAiErr) {
                        console.error('❌ Guardian AI Error:', gAiErr.message);
                    } finally {
                        setTimeout(() => guardianBusySet.delete(jid), 2000);
                    }
                }
                // 🎯 DEFAULT DYNAMIC GUARDIAN MENU (1 बच्चा या 2+ बच्चों के अनुसार खुद भाषा बदलेगा)
                const opt1Label = isMultiChild ? 'सभी बच्चों की प्रोफाइल एवं फीस बकाया देखें' : 'बच्चे की प्रोफाइल एवं फीस बकाया देखें';
                const opt2Label = isMultiChild ? 'सभी बच्चों की लॉगिन ID एवं Password देखें' : 'बच्चे की लॉगिन ID एवं Password देखें';

                let studentListBlock = '';
                let sampleName = '#Aditya';
                let sampleEnroll = '1024';

                if (registeredStudents.length > 0) {
                    sampleEnroll = registeredStudents[0].enrolment || '1024';
                    sampleName = `#${(registeredStudents[0].name || 'Aditya').split(' ')[0]}`;

                    if (isMultiChild) {
                        studentListBlock = `\n👨‍👧‍👦 *आपके नंबर से पंजीकृत विद्यार्थी:*\n`;
                        registeredStudents.forEach(st => {
                            studentListBlock += `• *${st.name}* (${st.class}) — Enrolment: \`${st.enrolment}\`\n`;
                        });
                    }
                }

                const guardianMenu = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई (वाराणसी)*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🙏 *अभिभावक डिजिटल सेवा केंद्र (Parent Desk)*\n` +
                    `नमस्ते आदरणीय अभिभावक जी! आपका स्वागत है।\n\n` +
                    `🔗 *छात्र लाइव पोर्टल:*\nhttps://jrdschool.online/studentdemo.html\n\n` +
                    `📋 *सुविधा हेतु विकल्प चुनें:*\n` +
                    `1️⃣ *${opt1Label}*\n` +
                    `2️⃣ *${opt2Label}*\n` +
                    `3️⃣ *स्कूल टाइमिंग (समय सारणी)*\n` +
                    `4️⃣ *नया एडमिशन (2026-27) एवं प्रबंधक संदेश*\n` +
                    `5️⃣ *विद्यालय लोकेशन (Google Map)*\n` +
                    `6️⃣ *स्कूल मोबाइल ऐप (APK) डाउनलोड करें*\n` +
                    `${studentListBlock}\n` +
                    `👉 _कृपया केवल **1**, **2**, **3**, **4**, **5** या **6** लिखकर भेजें।_\n\n` +
                    `🔎 *किसी एक बच्चे का विवरण देखने हेतु:*\n` +
                    `बच्चे का **नाम (# के साथ)** या **Enrolment No.** लिखकर भेजें _(उदा: *${sampleName}* या *${sampleEnroll}*)_\n\n` +
                    `_आपका नंबर पंजीकृत है ✅_`;

              await sendReply(jid, guardianMenu);
                return;
            }
                })();
            }
        });

    } catch (err) {
        isConnecting = false;
        console.error('❌ startBot त्रुटि:', err.message);
    }
}

async function sendReply(jid, text) {
    try {
        if (sock && isBotReady) {
            const sent = await sock.sendMessage(jid, { text });
           if (sent?.key?.id) {
                messageCache.set(sent.key.id, { conversation: text });
                if (messageCache.size > 500) messageCache.delete(messageCache.keys().next().value);
            }
        }
    } catch (err) {
        console.error('❌ उत्तर भेजने में त्रुटि:', err.message);
    }
}
const SCHOOL_UPI_ID = "sarveshverma3590@naviaxis";
const SCHOOL_PAYEE_NAME = "JRD Public School Marui";
const BOT_BASE_URL = "https://mp7k2cqazf71-production-noqbsigv.us-central1.suga.run";

function extractDueItemsForVoice_(rawDueText) {
    if (!rawDueText) return "";
    const lines = String(rawDueText)
        .replace(/<br\s*\/?>/gi, "\n")
        .split("\n")
        .map(l => l
            .replace(/[•✅❌⚠️🎉🚩🧾📊💳]/g, " ")
            .replace(/\(आंशिक बकाया\)|\(बकाया\)|\(आंशिक जमा\)/gi, " ")
            .replace(/₹/g, " ")
            .replace(/[*_`]/g, "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(l => l.length > 0 && !/सभी फ़ीस जमा|कोई बकाया नहीं/i.test(l));

    return lines.join(", ");
}

function buildFeeDueVoiceScript_({ studentName, className, grandDue, dueText }) {
    const sName = String(studentName || "विद्यार्थी").trim();
    const cName = String(className || "").trim();
    const classPart = cName ? `, कक्षा ${cName},` : ",";
    const amt = Math.round(parseFloat(grandDue) || 0);

    if (amt <= 0) {
        return `नमस्ते! आदरणीय अभिभावक जी, जे आर डी पब्लिक स्कूल मरुई से सादर प्रणाम। आपके प्रिय बच्चे ${sName}${classPart} की कोई फीस बकाया नहीं है। आप एक जागरूक नागरिक हैं और समय पर सहयोग करते हैं, इसके लिए हृदय से धन्यवाद!`;
    }

    const itemsSpoken = extractDueItemsForVoice_(dueText);
    const breakdownPart = itemsSpoken ? `जिसमें ${itemsSpoken} शामिल हैं — ` : "";

    return `नमस्ते! आदरणीय अभिभावक जी, जे आर डी पब्लिक स्कूल मरुई से विनम्र निवेदन है। आपके प्रिय बच्चे ${sName}${classPart} की फीस बकाया है, ${breakdownPart}कुल मिलाकर ${amt} रुपये देय हैं। कृपया विद्यालय में सही समय पर फीस जमा करें, क्योंकि आप ही के सहयोग से विद्यालय का वित्तीय संचालन और विकास कार्य आगे बढ़ता है तथा शिक्षकों का समय पर वेतन भी देना होता है। किसी भी जानकारी या व्यवस्था हेतु विद्यालय कार्यालय में संपर्क करें। धन्यवाद!`;
}

function buildGuardianPaymentAssets(student) {
    const currentDue = parseFloat(student.current_due) || 0;
    const oldDue = parseFloat(student.old_due) || 0;
    const grandDue = Math.round(parseFloat(student.grand_due) || (currentDue + oldDue));

    if (grandDue <= 0) return null;

    const labelPart = `${student.enrolment || ''} ${student.name || 'Fee'}`.trim();
    const tn = encodeURIComponent(labelPart);
    const upiLink = `upi://pay?pa=${encodeURIComponent(SCHOOL_UPI_ID)}&pn=${encodeURIComponent(SCHOOL_PAYEE_NAME)}&am=${grandDue}&cu=INR&tn=${tn}`;
    const payLink = `${BOT_BASE_URL}/pay?pa=${encodeURIComponent(SCHOOL_UPI_ID)}&pn=${encodeURIComponent(SCHOOL_PAYEE_NAME)}&am=${grandDue}&tn=${tn}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiLink)}`;

    return { grandDue, payLink, qrUrl };
}
async function sendStudentProfileCard(jid, s) {
    const currentDue = parseFloat(s.current_due) || 0;
    const oldDue     = parseFloat(s.old_due) || 0;
    const grandDue   = parseFloat(s.grand_due) || (currentDue + oldDue);
    const payAssets  = buildGuardianPaymentAssets(s);

    const paymentNoticeBlock = grandDue > 0
        ? `\n🚨 *कृपया जल्द से जल्द फीस को जमा करें।*\n` +
          `🏢 *किसी भी सहायता या जानकारी हेतु विद्यालय कार्यालय में संपर्क करें।*\n` +
          (payAssets ? `📲 *ऑनलाइन भुगतान लिंक:* ${payAssets.payLink}\n` : ``)
        : `\n🎉 *आपके पाल्य की सभी फीस जमा है।*\n` +
          `🏢 *किसी भी जानकारी हेतु विद्यालय कार्यालय में संपर्क करें।*\n`;

    const replyMsg = `🎓 *STUDENT OFFICIAL PROFILE*\n🏫 *JRD Public School, Marui*\n📅 *सत्र:* ${s.session || '2026-27'}\n━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Enrolment No:* \`${s.enrolment || 'N/A'}\` \n📜 *Scholar No:* ${s.scholar_no || 'N/A'}\n🔢 *Roll No:* ${s.roll_no || 'N/A'}\n\n👤 *छात्र का नाम:* *${s.name}*\n👨‍👦 *पिता का नाम:* ${s.father}\n👩‍👦 *माता का नाम:* ${s.mother}\n🏫 *कक्षा:* ${s.class} (${s.type || 'REGULAR'})\n\n💰 *कुल जमा शुल्क:* ₹${s.total_paid || 0}\n\n📊 *जमा विवरण:*\n${s.paid_list || 'कोई जमा रिकॉर्ड दर्ज नहीं है'}\n\n⚠️ *बकाया विवरण:*\n${s.due_list || 'सभी फ़ीस जमा हैं 🎉'}\n\n━━━━━━━━━━━━━━━━━━━━━━━\n🧾 *कुल बकाया ब्रेकडाउन (DUE SUMMARY):*\n• *चालू सत्र बकाया:* ₹${currentDue}\n• *पिछला बकाया (Old Due):* ₹${oldDue}\n---------------------------------------\n🚩 *कुल देय राशि (GRAND TOTAL DUE): ₹${grandDue}*\n━━━━━━━━━━━━━━━━━━━━━━━${paymentNoticeBlock}_यदि विवरण में त्रुटि हो, तो विद्यालय कार्यालय में संपर्क करें।_`;

    await sendReply(jid, replyMsg);

    if (payAssets && sock && isBotReady) {
        try {
            await new Promise(res => setTimeout(res, 1500));
            await sock.sendMessage(jid, {
                image: { url: payAssets.qrUrl },
                caption: `💳 *FEE PAYMENT QR — ${String(s.name || '').toUpperCase()}*\n🚩 *कुल बकाया राशि:* ₹${payAssets.grandDue}/-\n\nकृपया जल्द से जल्द फीस को जमा करें। QR स्कैन करें या ऊपर दिए लिंक से भुगतान करें।\n🏢 *कार्यालय में संपर्क करें।*`
            });
        } catch (qrErr) {
            console.error('⚠️ Profile QR send error:', qrErr.message);
        }
    }

    if (sock && isBotReady) {
        try {
            await new Promise(res => setTimeout(res, 1500));
            const voiceScript = buildFeeDueVoiceScript_({
                studentName: s.name,
                className: s.class,
                grandDue: grandDue,
                dueText: (s.due_list || '') + (oldDue > 0 ? `
पिछला बकाया ${oldDue} रुपये` : '')
            });
            const audioBuffer = await generateHindiVoiceNote(voiceScript);
            if (audioBuffer) {
                await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
            }
        } catch (vErr) {
            console.error('⚠️ Profile voice send error:', vErr.message);
        }
    }
}

// 📄 BRANDED ADMISSION / PROMOTION PDF CERTIFICATE BUILDER
async function sendAdmissionOrPromotionPdf(jid, item) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 30 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    const actionType = String(item.type || item.action || '').toUpperCase();
                    const isPromo = actionType.includes('PROMOT') || item.type === 'PROMOTION_CONFIRMATION' || item.action === 'PROMOTION_CONFIRMATION';

                    const title = isPromo ? 'Promotion_Certificate' : 'Admission_Confirmation';
                    const captionText = `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n📄 छात्र *${item.studentName || item.name || ''}* का आधिकारिक ${isPromo ? 'कक्षा पदोन्नति प्रमाण पत्र एवं स्वीकृत फ़ीस विवरण (Promotion Letter)' : 'प्रवेश पत्र एवं फ़ीस विवरण (Admission Form)'} PDF।`;

                    if (sock && isBotReady) {
                        await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `${title}_${safePdfText(item.studentName || item.name, 'Student')}.pdf`,
                            caption: captionText
                        });
                        console.log(`✅ ${isPromo ? 'प्रमोशन' : 'एडमिशन'} PDF सफलतापूर्वक प्रेषित!`);
                    }
                    resolve();
                } catch (e) {
                    console.error('❌ Admission/Promotion PDF Send Error:', e.message);
                    resolve();
                }
            });

            const actionType = String(item.type || item.action || '').toUpperCase();
            const isPromo = actionType.includes('PROMOT') || item.type === 'PROMOTION_CONFIRMATION' || item.action === 'PROMOTION_CONFIRMATION';
            const mainColor = isPromo ? '#0F766E' : '#1A365D';

            doc.save();
            doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.fillColor(mainColor).fillOpacity(0.03).fontSize(38).font('Helvetica-Bold');
            doc.text('J.R.D. PUBLIC SCHOOL', doc.page.width / 2 - 220, doc.page.height / 2 - 20, { align: 'center' });
            doc.restore();

            doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30).lineWidth(2).strokeColor(mainColor).stroke();
            doc.rect(19, 19, doc.page.width - 38, doc.page.height - 38).lineWidth(0.5).strokeColor(mainColor).stroke();

            doc.rect(25, 25, doc.page.width - 50, 65).fillColor(mainColor).fill();
            doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 25, 34, { align: 'center' });
            doc.fontSize(8.5).font('Helvetica').text('Gram & Post - Marui, Cholapur, Varanasi (U.P.) - 221208', 25, 59, { align: 'center' });
            doc.fontSize(8).font('Helvetica-Bold').text('UDISE CODE: 09670804504 | BOARD: BASIC SHIKSHA PARISHAD U.P.', 25, 71, { align: 'center' });

            doc.rect(25, 100, doc.page.width - 50, 24).fillColor('#F1F5F9').fill();
            doc.fillColor(mainColor).fontSize(10.5).font('Helvetica-Bold').text(
                isPromo ? 'OFFICIAL CLASS PROMOTION CERTIFICATE & APPROVED FEE STRUCTURE (2026-27)' : 'OFFICIAL ADMISSION CONFIRMATION SLIP & FEE STRUCTURE (2026-27)',
                25, 107, { align: 'center' }
            );

            const gridTop = 135;
            doc.rect(25, gridTop, doc.page.width - 50, 140).lineWidth(0.5).strokeColor('#CBD5E1').stroke();

            let rowY = gridTop + 8;
            const drawRow = (label, value, isBoldVal = false) => {
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(label, 35, rowY);
                doc.font(isBoldVal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(isBoldVal ? mainColor : '#0F172A').text(safePdfText(value, 'N/A'), 220, rowY);
                doc.moveTo(25, rowY + 15).lineTo(doc.page.width - 25, rowY + 15).strokeColor('#E2E8F0').stroke();
                rowY += 21;
            };

            const classDisplayVal = (isPromo && item.fromClass) 
                ? `${item.fromClass}  ->  ${item.className || item.class}` 
                : (item.className || item.class || 'N/A');

            drawRow('Student Full Name :', item.studentName || item.name, true);
            drawRow("Father's Name :", item.fatherName || item.father);
            drawRow("Mother's Name :", item.motherName || item.mother);
            drawRow('Scholar / Enrollment No (SR) :', item.scholarNo || item.scholar_no || item.enroll, true);
            drawRow(isPromo ? 'Promoted Class :' : 'Allocated Class :', classDisplayVal, true);
            drawRow('Category / Student Type :', item.studentType || (isPromo ? 'PROMOTED (OLD)' : 'NEW ADMISSION'));

            const feeTop = gridTop + 152;
            doc.rect(25, feeTop, doc.page.width - 50, 20).fillColor(mainColor).fill();
            doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text('APPROVED SESSION FEE BREAKDOWN (2026-27)', 35, feeTop + 5);

            let feeY = feeTop + 24;
            doc.rect(25, feeY, doc.page.width - 50, 18).fillColor('#F1F5F9').fill();
            doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
            doc.text('Fee Component', 35, feeY + 4);
            doc.text('Approved Amount', doc.page.width - 160, feeY + 4, { align: 'right' });
            feeY += 20;

            let totalFeeSum = 0;
            const addFeeRow = (label, amt) => {
                if (!amt || parseFloat(amt) <= 0) return;
                let numAmt = parseFloat(amt);
                totalFeeSum += numAmt;
                doc.font('Helvetica').fontSize(9).fillColor('#334155').text(label, 35, feeY);
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A').text(`Rs. ${numAmt.toLocaleString('en-IN')}/-`, doc.page.width - 160, feeY, { align: 'right' });
                doc.moveTo(25, feeY + 14).lineTo(doc.page.width - 25, feeY + 14).strokeColor('#E2E8F0').stroke();
                feeY += 18;
            };

           let feeStruct = item.feeStructure || {};
            let mSingle = parseFloat(feeStruct.monthly_fee || item.monthlyFee || 0);
            let mTotal = parseFloat(feeStruct.monthly_total || (mSingle * 12) || 0);

            if (mTotal > 0) addFeeRow(`Tuition Fee (Monthly: Rs.${mSingle} x 12 Months)`, mTotal);
            addFeeRow('Admission Fee', feeStruct.admission_fee || item.admission_fee);
            addFeeRow('Registration Fee', feeStruct.registration_fee || item.registration_fee);
            addFeeRow('Class Change Fee', feeStruct.class_change_fee || item.class_change_fee);
            addFeeRow('Half Yearly Exam Fee', feeStruct.half_yearly_exam_fee || item.half_yearly_exam_fee);
            addFeeRow('Annual Exam Fee', feeStruct.annual_exam_fee || item.annual_exam_fee);
            addFeeRow('Practical Exam Fee', feeStruct.practical_fee || item.practical_fee);
            addFeeRow('Board Exam Fee', feeStruct.board_fee || item.board_fee);
            addFeeRow('Admit Card Fee', feeStruct.admit_card_fee || item.admit_card_fee);

            let grandTotalAmt = parseFloat(feeStruct.grand_total || item.totalAmount || totalFeeSum || 0);
            doc.rect(25, feeY, doc.page.width - 50, 22).fillColor('#E0E7FF').fill();
            doc.fillColor(mainColor).fontSize(10).font('Helvetica-Bold');
            doc.text('TOTAL APPROVED ANNUAL FEE :', 35, feeY + 6);
            doc.text(`Rs. ${grandTotalAmt.toLocaleString('en-IN')}/-`, doc.page.width - 160, feeY + 6, { align: 'right' });

            const footerY = doc.page.height - 115;
            doc.rect(25, footerY, doc.page.width - 50, 36).fillColor('#F8FAFC').fill();
            doc.fillColor('#334155').fontSize(8).font('Helvetica-Oblique').text(
                isPromo 
                ? 'Declaration: Hearty congratulations on your promotion! Please adhere to the approved fee structure and official guidelines for session 2026-27.'
                : 'Declaration: Welcome to J.R.D. Public School family! Please adhere to the approved fee structure and official school guidelines for session 2026-27.',
                32, footerY + 8, { width: doc.page.width - 64, align: 'justify' }
            );

            const sigY = doc.page.height - 55;
            doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
            doc.text('Parent / Guardian Signature', 35, sigY);
            doc.text('Admission In-Charge', 240, sigY);
            doc.text('Principal / Official Seal', doc.page.width - 150, sigY, { align: 'right' });

            doc.end();
        } catch (err) {
            console.error('❌ Admission/Promotion PDF Build Error:', err.message);
            resolve();
        }
    });
}

function buildBrandedFeePdfDoc(doc, data, opts) {
    const headerColor = opts.headerColor || '#1A365D';
    const bandLabel = opts.bandLabel || 'OFFICIAL FEE STATEMENT';

    doc.rect(10, 10, doc.page.width - 20, doc.page.height - 20).lineWidth(1.5).stroke(headerColor);
    doc.rect(13, 13, doc.page.width - 26, doc.page.height - 26).lineWidth(0.5).stroke(headerColor);

    doc.rect(20, 20, doc.page.width - 40, 55).fill(headerColor);
    doc.fillColor('#FFFFFF').fontSize(15).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 20, 28, { align: 'center' });
    doc.fontSize(8.5).font('Helvetica').text('Marui, Varanasi (U.P.) - 221208 | UDISE: 09670804504', 20, 48, { align: 'center' });

    doc.fillColor('#000000');
    doc.rect(20, 80, doc.page.width - 40, 20).fill('#E2E8F0');
    doc.fillColor(headerColor).fontSize(9.5).font('Helvetica-Bold').text(bandLabel, 20, 85, { align: 'center' });

    const metaTop = 108;
    doc.rect(20, metaTop, doc.page.width - 40, 70).lineWidth(0.5).stroke('#CBD5E1');

    doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold');
    doc.text(`Student Name: `, 28, metaTop + 8);
    doc.font('Helvetica').text(`${safePdfText(data.name || data.studentName, 'STUDENT')}`, 100, metaTop + 8);

    doc.font('Helvetica-Bold').text(`Class & Sec  : `, 28, metaTop + 25);
    doc.font('Helvetica').text(`${data.className || 'N/A'}`, 100, metaTop + 25);

    doc.font('Helvetica-Bold').text(`Enrolment    : `, 28, metaTop + 42);
    doc.font('Helvetica').text(`${safePdfText(data.scholarNo || data.rid, 'N/A')}`, 100, metaTop + 42);

    const rightX = doc.page.width / 2 + 10;
    doc.font('Helvetica-Bold').text(`Session : `, rightX, metaTop + 8);
    doc.font('Helvetica').text(`${safePdfText(data.session, '2026-27')}`, rightX + 45, metaTop + 8);

    doc.font('Helvetica-Bold').text(`Status  : `, rightX, metaTop + 25);
    doc.fillColor('#15803D').font('Helvetica-Bold').text(`${opts.statusLabel || 'DUE'}`, rightX + 45, metaTop + 25);

    doc.fillColor('#334155').font('Helvetica-Bold').text(`Date    : `, rightX, metaTop + 42);
    const todayDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    doc.font('Helvetica').text(`${todayDate}`, rightX + 45, metaTop + 42);

    const tableTop = 188;
    doc.rect(20, tableTop, doc.page.width - 40, 18).fill('#F1F5F9');
    doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
    doc.text('Head', 28, tableTop + 4);
    doc.text('Demand', 280, tableTop + 4);
    doc.text('Received', 350, tableTop + 4);
    doc.text('Status', doc.page.width - 90, tableTop + 4);
    doc.moveTo(20, tableTop + 18).lineTo(doc.page.width - 20, tableTop + 18).stroke('#CBD5E1');

    let rowY = tableTop + 24;
    const rows = Array.isArray(data.breakdown) ? data.breakdown : [];
    if (rows.length > 0) {
        doc.fontSize(8).font('Helvetica');
        rows.forEach(row => {
            doc.fillColor('#334155').text(String(row.label || ''), 28, rowY, { width: 240 });
            doc.text(`Rs.${row.demand || 0}`, 280, rowY);
            doc.fillColor('#15803D').text(`Rs.${row.received || 0}`, 350, rowY);
            doc.fillColor(row.status === 'DUE' ? '#B91C1C' : '#15803D').text(String(row.status || ''), doc.page.width - 90, rowY);
            rowY += 16;
        });
    } else {
        doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
        const cleanDetails = (data.details || '').replace(/<br>/g, '\n') || 'School Tuition / Fee Payment';
        doc.text(cleanDetails, 28, rowY, { width: doc.page.width - 60 });
        rowY += 40;
    }

    const totalBoxY = Math.max(rowY + 10, doc.page.height - 110);
    doc.rect(20, totalBoxY, doc.page.width - 40, 26).fill(headerColor);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
    doc.text(opts.totalLabel || 'TOTAL AMOUNT:', 28, totalBoxY + 8);
    doc.text(`Rs. ${opts.totalAmount || 0}/-`, doc.page.width - 130, totalBoxY + 8, { align: 'right' });

    const footerY = doc.page.height - 70;
    doc.fillColor('#64748B').fontSize(7).font('Helvetica-Oblique');
    doc.text(opts.footerNote || 'This is an officially generated digital fee statement from J.R.D. Public School Administration.', 20, footerY, { align: 'center' });

    doc.rect(doc.page.width - 115, footerY - 5, 95, 30).lineWidth(0.5).stroke('#CBD5E1');
    doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold');
    doc.text('OFFICIAL SEAL & STAMP', doc.page.width - 115, footerY + 8, { width: 95, align: 'center' });
}

async function sendFeePdfReceipt(jid, data) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    if (sock && isBotReady) {
                        const captionText = `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n🧾 छात्र *${data.name || data.studentName || ''}* की आधिकारिक फीस जमा रसीद।`;
                        const sent = await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `Fee_Receipt_${safePdfText(data.rid, 'RECEIPT')}.pdf`,
                            caption: captionText
                        });
                        if (sent?.key?.id) {
                            messageCache.set(sent.key.id, { documentMessage: { caption: captionText, fileName: `Fee_Receipt_${safePdfText(data.rid, 'RECEIPT')}.pdf` } });
                        }
                    }
                    resolve();
                } catch (e) {
                    console.error('PDF Send Error:', e.message);
                    resolve();
                }
            });

            buildBrandedFeePdfDoc(doc, data, {
                headerColor: '#1A365D',
                bandLabel: 'OFFICIAL FEE PAYMENT RECEIPT',
                statusLabel: 'PAID OK',
                totalLabel: 'TOTAL AMOUNT RECEIVED:',
                totalAmount: data.paid || 0,
                footerNote: 'This is an officially generated digital fee receipt from J.R.D. Public School Administration.'
            });

            doc.end();
        } catch (err) {
            console.error('PDF Receipt Build Error:', err.message);
            resolve();
        }
    });
}

async function sendFeeReminderPdf(jid, data) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A5', margin: 20 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(buffers);
                    if (sock && isBotReady) {
                        const captionText = `🏫 *J.R.D. PUBLIC SCHOOL*\n📄 छात्र *${data.studentName || data.name || ''}* का आधिकारिक बहीखाता विवरण PDF।`;
                        await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `Fee_Notice_${safePdfText(data.studentName || data.name, 'Notice')}.pdf`,
                            caption: captionText
                        });
                    }
                    resolve();
                } catch (e) {
                    console.error('PDF Reminder Send Error:', e.message);
                    resolve();
                }
            });

            buildBrandedFeePdfDoc(doc, data, {
                headerColor: '#B91C1C',
                bandLabel: data.type === 'FEE_STRUCTURE_COMBO' ? 'FULL SESSION FEE STRUCTURE' : 'OFFICIAL FEE REMINDER NOTICE',
                statusLabel: 'DUE',
                totalLabel: 'TOTAL OUTSTANDING DUES:',
                totalAmount: data.totalAmount || 0,
                footerNote: 'Principal / Accounts Administration -- J.R.D. Public School'
            });

            doc.end();
        } catch (err) {
            console.error('PDF Reminder Build Error:', err.message);
            resolve();
        }
    });
}
// 📄 OFFICIAL A4 JRD NOTICE PDF BUILDER (Letterhead Engine)
// 📄 OFFICIAL A4 JRD NOTICE PDF BUILDER (Letterhead Engine - Upgraded Safe Version)
function buildOfficialNoticePdfBuffer(title, message, recipientName, dateStr) {
    return new Promise((resolve) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 30 });
            let buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            const mainColor = '#1A365D'; // Official Navy

            // Watermark (बैकग्राउंड वाटरमार्क)
            doc.save();
            doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.fillColor(mainColor).fillOpacity(0.03).fontSize(38).font('Helvetica-Bold');
            doc.text('J.R.D. PUBLIC SCHOOL', doc.page.width / 2 - 220, doc.page.height / 2 - 20, { align: 'center' });
            doc.restore();

            // Borders (डबल बॉर्डर)
            doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30).lineWidth(2).strokeColor(mainColor).stroke();
            doc.rect(19, 19, doc.page.width - 38, doc.page.height - 38).lineWidth(0.5).strokeColor(mainColor).stroke();

            // Header Banner
            doc.rect(25, 25, doc.page.width - 50, 65).fillColor(mainColor).fill();
            doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 25, 34, { align: 'center' });
            doc.fontSize(8.5).font('Helvetica').text('Gram & Post - Marui, Cholapur, Varanasi (U.P.) - 221208', 25, 59, { align: 'center' });
            doc.fontSize(8).font('Helvetica-Bold').text('UDISE: 09670804504 | AFFILIATED TO BASIC SHIKSHA PARISHAD U.P.', 25, 71, { align: 'center' });

            // Title Strip (शीर्षक पट्टी)
            doc.rect(25, 100, doc.page.width - 50, 24).fillColor('#F1F5F9').fill();
            const cleanTitle = safePdfText(title, 'OFFICIAL CIRCULAR / NOTICE');
            doc.fillColor(mainColor).fontSize(11).font('Helvetica-Bold').text(cleanTitle, 25, 107, { align: 'center' });

            // Meta Info (दिनांक और प्राप्तकर्ता)
            const cleanRecipient = safePdfText(recipientName, 'All Concerned');
            const cleanDate = dateStr || new Date().toLocaleDateString('en-GB');

            doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text(`Date: ${cleanDate}`, 35, 135);
            doc.text(`Recipient: ${cleanRecipient}`, doc.page.width - 200, 135, { align: 'right' });
            doc.moveTo(25, 150).lineTo(doc.page.width - 25, 150).strokeColor('#CBD5E1').stroke();

            // Notice Message Body (टेक्स्ट को साफ़ और सही लाइनिंग में प्रिंट करना)
            doc.fillColor('#0F172A').fontSize(10).font('Helvetica');
            
            let rawMsg = String(message || '').replace(/<br\s*[\/]?>/gi, '\n').replace(/\*/g, '');
            let cleanBody = safePdfText(rawMsg, 'Official notice text detail.');

            doc.text(cleanBody, 35, 165, { 
                width: doc.page.width - 70, 
                lineGap: 5, 
                align: 'left' 
            });

            // Footer Signature (हस्ताक्षर एवं मुहर)
            const sigY = doc.page.height - 75;
            doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
            doc.text('Authorized Signatory', 35, sigY);
            doc.text('Principal / Official Seal', doc.page.width - 160, sigY, { align: 'right' });
            doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#64748B').text('J.R.D. Public School Administration - System Generated Circular', 25, doc.page.height - 35, { align: 'center' });

            doc.end();
        } catch (e) {
            console.error('❌ PDF Buffer Build Error:', e.message);
            resolve(null);
        }
    });
}

async function generateHindiVoiceNote(text) {
    if (!text || String(text).trim().length === 0) {
        console.log('⚠️ वॉइस जनरेशन निरस्त: टेक्स्ट खाली है।');
        return null;
    }

    // TTS ke liye text saaf karo (emoji / markdown symbols se audio khali aa sakta hai)
    const cleanText = String(text)
        .replace(/[*_~`#>]/g, '')
        .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
        .replace(/[<&]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleanText) return null;

    const stamp = Date.now() + '_' + Math.floor(Math.random() * 1000000);
    const mp3Path = path.join(os.tmpdir(), `swara_raw_${stamp}.mp3`);
    const oggPath = path.join(os.tmpdir(), `swara_final_${stamp}.ogg`);

    const cleanup = () => {
        try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch (e) {}
        try { if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath); } catch (e) {}
    };

    try {
        let mp3Buffer = null;
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts && !mp3Buffer; attempt++) {
            try {
                const tts = new MsEdgeTTS();
                await tts.setMetadata(HINDI_FEMALE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

                const res = await tts.toStream(cleanText);
                // v2 => { audioStream }, v1 => seedha stream
                const stream = (res && res.audioStream) ? res.audioStream : res;

                const chunks = [];
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('TTS stream timeout (25s)')), 25000);
                    stream.on('data', (c) => chunks.push(Buffer.from(c)));
                    stream.on('end', () => { clearTimeout(timer); resolve(); });
                    stream.on('close', () => { clearTimeout(timer); resolve(); });
                    stream.on('error', (e) => { clearTimeout(timer); reject(e); });
                });

                const buf = Buffer.concat(chunks);
                if (buf.length > 1000) {
                    mp3Buffer = buf;
                } else {
                    throw new Error(`Audio bahut chhota aaya (${buf.length} bytes)`);
                }
            } catch (connErr) {
                console.error(`⚠️ Edge-TTS प्रयास ${attempt} विफल:`, connErr.message);
                if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1500));
            }
        }

        if (!mp3Buffer) {
            console.error('❌ Edge-TTS से ऑडियो नहीं मिला (msedge-tts@latest install करें)।');
            cleanup();
            return null;
        }

        fs.writeFileSync(mp3Path, mp3Buffer);
        console.log(`🎙️ MP3 तैयार: ${mp3Buffer.length} bytes`);

        return await new Promise((resolveFinal) => {
            ffmpeg(mp3Path)
                .noVideo()
                .audioCodec('libopus')
                .audioChannels(1)
                .audioFrequency(48000)
                .audioBitrate('32k')
                .format('ogg')
                .addOutputOptions(['-application voip'])
                .on('end', () => {
                    try {
                        const finalBuffer = fs.readFileSync(oggPath);
                        console.log(`✅ OGG तैयार: ${finalBuffer.length} bytes`);
                        cleanup();
                        resolveFinal(finalBuffer);
                    } catch (readErr) {
                        console.error('❌ OGG पढ़ने में विफलता:', readErr.message);
                        cleanup();
                        resolveFinal(null);
                    }
                })
                .on('error', (ffmpegErr) => {
                    console.error('❌ FFmpeg Opus एन्कोडिंग विफल:', ffmpegErr.message);
                    cleanup();
                    resolveFinal(null);
                })
                .save(oggPath);
        });

    } catch (finalCatchErr) {
        console.error('❌ generateHindiVoiceNote अपवाद:', finalCatchErr.message);
        cleanup();
        return null;
    }
}

// 🛡️ सुरक्षित और क्रैश-प्रूफ ऑटो-मैसेज प्रोसेसिंग क्यू (डिस्क बैकअप + रीट्राई)
const QUEUE_FILE = path.join(__dirname, 'pending_queue.json');
let messageQueue = [];
let failedAlertsLog = [];
let isProcessingQueue = false;

function saveQueueToDisk() {
    try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(messageQueue)); } catch (e) {}
}

function loadQueueFromDisk() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const saved = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
            if (Array.isArray(saved) && saved.length > 0) {
                messageQueue = saved;
                console.log(`♻️ रीस्टार्ट के बाद ${messageQueue.length} पेंडिंग संदेश रिकवर हुए!`);
            }
        }
    } catch (e) {}
}
loadQueueFromDisk();

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
     if (!sock || !isBotReady) {
            console.log('⏳ बॉट रीकनेक्ट हो रहा है, 5 सेकंड बाद पुनः प्रयास...');
            await new Promise(res => setTimeout(res, 5000));
            continue;
        }       
        const item = messageQueue[0];
        let sendFailed = false;
        let skipRetry = false;
        let failReason = '';
        try {
            const formattedNumber = normalizeIndianPhone(item.number);
            if (!formattedNumber) {
                skipRetry = true;
                failReason = 'अमान्य मोबाइल नंबर';
                throw new Error(failReason);
            }
            let jid = formattedNumber + '@s.whatsapp.net';

            if (sock && (isBotReady || sock.user)) {
                // ✅ भेजने से पहले वेरिफाई करें कि नंबर पर WhatsApp अकाउंट है या नहीं
                try {
                    const waCheck = await sock.onWhatsApp(jid);
                    if (Array.isArray(waCheck) && waCheck.length > 0) {
                        if (!waCheck[0].exists) {
                            skipRetry = true;
                            failReason = 'WhatsApp अकाउंट नहीं है';
                            throw new Error(failReason);
                        }
                        if (waCheck[0].jid) jid = waCheck[0].jid;
                    }
                } catch (chkErr) {
                    if (skipRetry) throw chkErr;
                }

              if (item.type === 'FEE_REMINDER_COMBO' || item.type === 'FEE_STRUCTURE_COMBO') {
                    let voiceScript = item.voiceText || "";
                    if (item.type === 'FEE_REMINDER_COMBO') {
                        const dueBlockMatch = String(item.message || "").match(/\*बकाया विवरण:\*\s*([\s\S]*?)\n━/);
                        const reminderDueText = dueBlockMatch ? dueBlockMatch[1] : "";
                        voiceScript = buildFeeDueVoiceScript_({
                            studentName: item.studentName || item.name || '',
                            className: item.className || '',
                            grandDue: item.totalAmount || 0,
                            dueText: reminderDueText
                        });
                    } else if (!voiceScript.trim()) {
                        voiceScript = `नमस्कार! प्रिय अभिभावक, जे आर डी पब्लिक स्कूल मरुई से विनम्र निवेदन है। आपके बच्चे ${item.studentName || ''} की फीस ${item.totalAmount || 0} रुपये है। धन्यवाद!`;
                    }
                    // 1️⃣ हिंदी वॉइस नोट (Recording इंडिकेटर के साथ)
                    try { await sock.sendPresenceUpdate('recording', jid); } catch (e) {}
                    const audioBuffer = await generateHindiVoiceNote(voiceScript);
                    try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}

                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                        // ⏱️ उसी बच्चे के अगले मैसेज से पहले कुल 5 सेकंड का गैप (3s रुककर + 2s typing)
                        await new Promise(res => setTimeout(res, 3000));
                        try { await sock.sendPresenceUpdate('composing', jid); } catch (e) {}
                        await new Promise(res => setTimeout(res, 2000));
                        try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}
                    }

                    // 2️⃣ QR इमेज के कैप्शन में पूरा हिसाब व /pay लिंक (फेल-सेफ सुरक्षा के साथ)
                    if (item.type === 'FEE_REMINDER_COMBO' && item.qrUrl) {
                        const cap = item.message || '';
                        try {
                            if (cap.length <= 1000) {
                                await sock.sendMessage(jid, { image: { url: item.qrUrl }, caption: cap });
                            } else {
                                await sock.sendMessage(jid, { text: cap });
                                await new Promise(res => setTimeout(res, 5000));
                                await sock.sendMessage(jid, { image: { url: item.qrUrl }, caption: '📲 फीस जमा करने हेतु QR स्कैन करें' });
                            }
                        } catch (qrErr) {
                            console.error('⚠️ QR इमेज फेल, टेक्स्ट रिमाइंडर भेजा जा रहा है:', qrErr.message);
                            if (cap) await sock.sendMessage(jid, { text: cap });
                        }
                    } else {
                        if (item.message) await sock.sendMessage(jid, { text: item.message });
                        await new Promise(res => setTimeout(res, 5000));
                        await sendFeeReminderPdf(jid, item);
                    }
                }

                // 🎯 B. NEW ADMISSION & CLASS PROMOTION CONFIRMATION
                else if (item.type === 'ADMISSION_CONFIRMATION' || item.type === 'PROMOTION_CONFIRMATION' || item.type === 'ADMISSION' || item.action === 'ADMISSION_NOTIFICATION' || item.action === 'addNewAdmission') {
                    const isPromo = item.type === 'PROMOTION_CONFIRMATION' || item.action === 'PROMOTION_CONFIRMATION';
                   const feeStruct = item.feeStructure || {};

                    let mSingle = parseFloat(feeStruct.monthly_fee || item.monthlyFee || 0);
                    let mTotal = parseFloat(feeStruct.monthly_total || (mSingle * 12) || 0);
                    let admFee = parseFloat(feeStruct.admission_fee || item.admission_fee || 0);
                    let regFee = parseFloat(feeStruct.registration_fee || item.registration_fee || 0);
                    let chgFee = parseFloat(feeStruct.class_change_fee || item.class_change_fee || 0);
                    let halfFee = parseFloat(feeStruct.half_yearly_exam_fee || item.half_yearly_exam_fee || 0);
                    let annuFee = parseFloat(feeStruct.annual_exam_fee || item.annual_exam_fee || 0);
                    let pracFee = parseFloat(feeStruct.practical_fee || item.practical_fee || 0);
                    let boardFee = parseFloat(feeStruct.board_fee || item.board_fee || 0);
                    let admitFee = parseFloat(feeStruct.admit_card_fee || item.admit_card_fee || 0);

                    let grandTotal = item.totalAmount || feeStruct.grand_total || feeStruct.total_amount || (mTotal + admFee + regFee + chgFee + halfFee + annuFee + pracFee + boardFee + admitFee);

                    let voiceFeeList = [];
                    if (mTotal > 0) voiceFeeList.push(`वार्षिक शिक्षण शुल्क ${mTotal} रुपये`);
                    if (admFee > 0) voiceFeeList.push(`प्रवेश शुल्क ${admFee} रुपये`);
                    if (regFee > 0) voiceFeeList.push(`पंजीकरण शुल्क ${regFee} रुपये`);
                    if (chgFee > 0) voiceFeeList.push(`कक्षा परिवर्तन शुल्क ${chgFee} रुपये`);
                    if (halfFee > 0) voiceFeeList.push(`छमाही परीक्षा शुल्क ${halfFee} रुपये`);
                    if (annuFee > 0) voiceFeeList.push(`वार्षिक परीक्षा शुल्क ${annuFee} रुपये`);
                    if (pracFee > 0) voiceFeeList.push(`प्रैक्टिकल फीस ${pracFee} रुपये`);
                    if (boardFee > 0) voiceFeeList.push(`बोर्ड परीक्षा शुल्क ${boardFee} रुपये`);
                    if (admitFee > 0) voiceFeeList.push(`एडमिट कार्ड शुल्क ${admitFee} रुपये`);

                    const feeDescText = voiceFeeList.length > 0 ? voiceFeeList.join(', ') : 'कोई अतिरिक्त शुल्क देय नहीं';
                    const sName = item.studentName || item.name || 'छात्र';
                    const cName = item.className || item.class || '-';

                    let voiceScript = isPromo
                        ? `नमस्कार! जे आर डी पब्लिक स्कूल मरुई में आपका हार्दिक स्वागत है। बधाई हो, आपके प्रिय बच्चे ${sName} को अगली कक्षा ${cName} में प्रमोट कर दिया गया है। नई कक्षा के लिए स्वीकृत फ़ीस का विवरण इस प्रकार है: ${feeDescText}। पूरे शैक्षणिक सत्र में कुल मिलाकर ${grandTotal} रुपये का शुल्क देय होगा। नये सत्र की हार्दिक शुभकामनाएँ!`
                        : `नमस्कार! जे आर डी PUBLIC SCHOOL मरुई परिवार में आपका हार्दिक स्वागत है। आपके प्रिय बच्चे ${sName} का कक्षा ${cName} में नया दाखिला सफलतापूर्वक पूर्ण हो चुका है। स्वीकृत फ़ीस का विवरण इस प्रकार है: ${feeDescText}। पूरे शैक्षणिक सत्र में कुल मिलाकर ${grandTotal} रुपये का शुल्क देय होगा। नये सत्र की ढेरों शुभकामनाएँ!`;

                    const audioBuffer = await generateHindiVoiceNote(voiceScript);
                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }

                    if (item.message && item.message.trim().length > 0) {
                        await sock.sendMessage(jid, { text: item.message });
                        await new Promise(res => setTimeout(res, 1500));
                    }

                    await sendAdmissionOrPromotionPdf(jid, item);
                }

                // 🎯 C. FEE PAYMENT RECEIPT
                else if (item.type === 'FEE_RECEIPT' || item.type === 'PAYMENT' || (parseFloat(item.paid) > 0 && item.rid)) {
                    let cleanDet = (item.details || '').replace(/<br>/g, "\n");
                    let studentNameClean = item.name || item.studentName || 'छात्र';
                    let paidAmount = item.paid || item.amount || 0;

                    let breakdownList = Array.isArray(item.breakdown) ? item.breakdown : [];
                    let voiceFeeList = [];
                    let textItems = [];

                    if (breakdownList.length > 0) {
                        breakdownList.forEach(b => {
                            let amt = parseFloat(b.received || b.amount || 0);
                            if (amt > 0) {
                                let labelName = b.label || 'शुल्क';
                                voiceFeeList.push(`${labelName} ${amt} रुपये`);
                                textItems.push(`• *${labelName}:* ₹${amt}/-`);
                            }
                        });
                    }

                    let textBreakdownDetails = textItems.length > 0 ? textItems.join('\n') : (cleanDet || `• *फीस जमा:* ₹${paidAmount}/-`);
                    let voiceBreakdownText = voiceFeeList.length > 0 ? "जमा की गई मदों का विवरण इस प्रकार है: " + voiceFeeList.join(', ') + "। " : "";

                    let textToSend = item.message || `🏫 *J.R.D. PUBLIC SCHOOL*\n📍 *मरुई, वाराणसी (उ.प्र.)*\n🧾 *आधिकारिक फीस जमा रसीद*\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *छात्र का नाम:* *${studentNameClean}*\n🏫 *कक्षा:* ${item.className || item.class || 'N/A'}\n📅 *सत्र:* ${item.session || '2026-27'}\n🆔 *रसीद संख्या:* \`${item.rid || 'N/A'}\` \n💰 *कुल जमा राशि:* ₹${paidAmount}/-\n\n📊 *जमा फीस मदवार विवरण (Fee Breakdown):*\n${textBreakdownDetails}\n━━━━━━━━━━━━━━━━━━━━━━━\n_आपकी जमा फीस की डिजिटल PDF रसीद नीचे संलग्न है।_\nधन्यवाद! - JRD Management`;

                    await sock.sendMessage(jid, { text: textToSend });
                    await new Promise(res => setTimeout(res, 1200));

                    let voiceScript = `नमस्ते! प्रिय अभिभावक, जे आर डी पब्लिक स्कूल मरुई में आपके प्रिय बच्चे ${studentNameClean} की कुल ${paidAmount} रुपये फीस सफलतापूर्वक जमा कर ली गई है। ${voiceBreakdownText}डिजिटल रसीद एवं बहीखाता विवरण संदेश में नीचे संलग्न है। धन्यवाद!`;
                    const audioBuffer = await generateHindiVoiceNote(voiceScript);
                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }

                    await new Promise(res => setTimeout(res, 1200));
                    await sendFeePdfReceipt(jid, item);
                }

                // 🎯 D. TEACHER WELCOME (TEXT + SWARA AI VOICE + 100% BRANDED OFFICIAL JOINING LETTER PDF)
                else if (item.type === 'TEACHER_WELCOME' || item.action === 'save_teacher') {
                    // 1. टेक्स्ट मैसेज भेजें
                    if (item.message && item.message.trim().length > 0) {
                        await sock.sendMessage(jid, { text: item.message });
                        await new Promise(res => setTimeout(res, 1200));
                    }

                    // 2. Swara AI वॉइस नोट
                    let audioBuffer = null;
                    if (item.audio_url && item.audio_url.startsWith('http')) {
                        try {
                            const audioRes = await axios.get(item.audio_url, { 
                                responseType: 'arraybuffer', 
                                timeout: 10000,
                                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                            });
                            audioBuffer = Buffer.from(audioRes.data);
                        } catch (e) {
                            console.error("⚠️ ऑनलाइन ऑडियो डाउनलोड फेल, स्वरा TTS से नया बना रहे हैं...");
                        }
                    }

                    if (!audioBuffer) {
                        const scriptText = `नमस्ते! आदरणीय ${item.name || 'शिक्षक'} जी, जानकी बाल शिक्षा निकेतन परिवार में आपका हार्दिक स्वागत एवं अभिनंदन है। आपकी लॉगिन आईडी, पासवर्ड और आधिकारिक नियुक्ति पत्र संदेश में नीचे भेजा जा रहा है। धन्यवाद!`;
                        audioBuffer = await generateHindiVoiceNote(scriptText);
                    }

                    if (audioBuffer) {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                        await new Promise(res => setTimeout(res, 1500));
                    }

                    // 3. 📄 100% BRANDED HIGH-QUALITY OFFICIAL JOINING LETTER PDF
                    try {
                        let pdfBuffer = null;

                        // यदि PHP URL दिया है तो डाउनलोड करने का प्रयास करें
                        if (item.pdf_url && item.pdf_url.startsWith('http')) {
                            try {
                                const pdfRes = await axios.get(item.pdf_url, { 
                                    responseType: 'arraybuffer', 
                                    timeout: 12000,
                                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                                });
                                const downloadedBuf = Buffer.from(pdfRes.data);
                                if (downloadedBuf.toString('utf8', 0, 4) === '%PDF') {
                                    pdfBuffer = downloadedBuf;
                                }
                            } catch (dErr) {
                                console.log("⚠️ PHP URL से PDF डाउनलोड नहीं हो पाया, ऑटो-जनरेटर यूज़ हो रहा है...");
                            }
                        }

                        // यदि PHP से PDF न मिले, तो Node.js खुद Branded A4 Official Joining Letter बनाएगा
                        if (!pdfBuffer) {
                            pdfBuffer = await new Promise((resolve) => {
                                const doc = new PDFDocument({ size: 'A4', margin: 30 });
                                let buffers = [];
                                doc.on('data', buffers.push.bind(buffers));
                                doc.on('end', () => resolve(Buffer.concat(buffers)));

                                const mainColor = '#1A365D'; // डार्क नेवी ब्लू
                                const todayDate = new Date().toLocaleDateString('en-IN', {
                                    timeZone: 'Asia/Kolkata',
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric'
                                });

                                const teacherName = item.name || item.studentName || 'Teacher';
                                const teacherId = item.teacher_id || item.teacherId || item.scholarNo || 'N/A';
                                const teacherPass = item.password || 'jrd123';
                                const teacherClass = item.className || item.class_assigned || item.class || 'Class 10';
                                const teacherSub = item.subject || 'General';
                                const teacherDesig = item.designation || 'Teacher';
                                const teacherPhone = item.number || item.phone || 'N/A';

                                // 🏛️ 1. वाटरमार्क
                                doc.save();
                                doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
                                doc.fillColor(mainColor).fillOpacity(0.03).fontSize(38).font('Helvetica-Bold');
                                doc.text('J.R.D. PUBLIC SCHOOL', doc.page.width / 2 - 220, doc.page.height / 2 - 20, { align: 'center' });
                                doc.restore();

                                // 🏛️ 2. डबल बॉर्डर
                                doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30).lineWidth(2).strokeColor(mainColor).stroke();
                                doc.rect(19, 19, doc.page.width - 38, doc.page.height - 38).lineWidth(0.5).strokeColor(mainColor).stroke();

                                // 🏛️ 3. स्कूल हेडर
                                doc.rect(25, 25, doc.page.width - 50, 65).fillColor(mainColor).fill();
                                doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text('J.R.D. PUBLIC SCHOOL', 25, 34, { align: 'center' });
                                doc.fontSize(8.5).font('Helvetica').text('Gram & Post - Marui, Cholapur, Varanasi (U.P.) - 221208', 25, 59, { align: 'center' });
                                doc.fontSize(8).font('Helvetica-Bold').text('UDISE CODE: 09670804504 | BOARD: BASIC SHIKSHA PARISHAD U.P.', 25, 71, { align: 'center' });

                                // 🏛️ 4. बैंड टाइटल
                                doc.rect(25, 100, doc.page.width - 50, 24).fillColor('#F1F5F9').fill();
                                doc.fillColor(mainColor).fontSize(10.5).font('Helvetica-Bold').text('OFFICIAL TEACHER APPOINTMENT & JOINING LETTER', 25, 107, { align: 'center' });

                                // 🏛️ 5. टीचर इंफॉर्मेशन टेबल ग्रिड
                                const gridTop = 135;
                                doc.rect(25, gridTop, doc.page.width - 50, 185).lineWidth(0.5).strokeColor('#CBD5E1').stroke();

                                let rowY = gridTop + 8;
                                const drawRow = (label, value, isBoldVal = false) => {
                                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(label, 35, rowY);
                                    doc.font(isBoldVal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(isBoldVal ? mainColor : '#0F172A').text(safePdfText(value, 'N/A'), 220, rowY);
                                    doc.moveTo(25, rowY + 15).lineTo(doc.page.width - 25, rowY + 15).strokeColor('#E2E8F0').stroke();
                                    rowY += 21;
                                };

                                drawRow('Teacher Full Name :', teacherName, true);
                                drawRow('Teacher ID / Username :', teacherId, true);
                                drawRow('Login Password :', teacherPass, true);
                                drawRow('Assigned Class :', teacherClass, true);
                                drawRow('Subject Assigned :', teacherSub);
                                drawRow('Designation / Post :', teacherDesig);
                                drawRow('Contact Number :', teacherPhone);
                                drawRow('Date of Joining :', todayDate);

                                // 🏛️ 6. रूल्स एंड गाइडलाइंस सेक्शन
                                const rulesTop = gridTop + 195;
                                doc.rect(25, rulesTop, doc.page.width - 50, 20).fillColor(mainColor).fill();
                                doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text('TEACHER PORTAL GUIDELINES & RESPONSIBILITIES', 35, rulesTop + 5);

                                doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
                                const rulesText = 
                                    `1. Attendance & Timetable: Please log in to your Teacher Portal at https://jrdschool.in using your Username and Password.\n` +
                                    `2. Daily Class Activity: Record student daily attendance, upload homework assignments, and submit exam marks regularly.\n` +
                                    `3. Code of Conduct: Maintain utmost discipline, academic standards, and moral guidance for student welfare.\n` +
                                    `4. Official System ID: Keep your login password confidential. Any system activity from your account is your responsibility.`;

                                doc.text(rulesText, 35, rulesTop + 28, { width: doc.page.width - 70, align: 'left', lineGap: 4 });

                                // 🏛️ 7. डिक्लेरेशन और सिग्नेचर
                                const footerY = doc.page.height - 110;
                                doc.rect(25, footerY, doc.page.width - 50, 32).fillColor('#F8FAFC').fill();
                                doc.fillColor('#334155').fontSize(8).font('Helvetica-Oblique').text(
                                    'Declaration: Welcome to J.R.D. Public School family! We look forward to your valuable contribution towards excellence in education for session 2026-27.',
                                    32, footerY + 8, { width: doc.page.width - 64, align: 'justify' }
                                );

                                const sigY = doc.page.height - 55;
                                doc.fillColor('#0F172A').fontSize(8.5).font('Helvetica-Bold');
                                doc.text('Teacher Signature', 35, sigY);
                                doc.text('Admission / HR In-Charge', 240, sigY);
                                doc.text('Principal / Official Seal', doc.page.width - 150, sigY, { align: 'right' });

                                doc.end();
                            });
                        }

                        // व्हाट्सएप पर PDF प्रेषित करें
                        await sock.sendMessage(jid, {
                            document: pdfBuffer,
                            mimetype: 'application/pdf',
                            fileName: `Joining_Letter_${safePdfText(item.name, 'Teacher')}.pdf`,
                            caption: `🏫 *J.R.D. PUBLIC SCHOOL (MARUI, VARANASI)*\n📄 आदरणीय *${item.name || 'शिक्षक'}* जी का आधिकारिक नियुक्ति पत्र (Joining Letter PDF) संलग्न है।`
                        });
                        console.log(`✅ Teacher Official Joining PDF (${item.name}) सफलतापूर्वक भेजा गया!`);

                    } catch (pErr) {
                        console.error("❌ Teacher PDF बनाने/भेजने में त्रुटि:", pErr.message);
                    }
                }
                 // 🎯 D2. TEACHER, STUDENT ATTENDANCE & ONLINE PAYMENT ALERT (TEXT + SWARA AI VOICE)
else if (item.type === 'ATTENDANCE_ALERT' || item.type === 'SUBJECT_MARKS_ALERT' || item.type === 'EXAM_ABSENT_ALERT' || item.type === 'STUDENT_ATTENDANCE' || item.type === 'TEACHER_ATTENDANCE' || item.type === 'ADMIN_PAYMENT_NOTIFICATION' || item.action === 'ONLINE_PAYMENT_ALERT') {
    if (item.message && item.message.trim().length > 0) {
        await sock.sendMessage(jid, { text: item.message });
        await new Promise(res => setTimeout(res, 1200));
    }

    if (item.voiceText && item.voiceText.trim().length > 0) {
        const audioBuffer = await generateHindiVoiceNote(item.voiceText);
        if (audioBuffer) {
            await sock.sendMessage(jid, { 
                audio: audioBuffer, 
                mimetype: 'audio/ogg; codecs=opus', 
                ptt: true 
            });
        }
    }
}

// 🎯 E. BROADCAST (VOICE / PDF / TEXT) — [NATIONAL LEVEL STABLE & DYNAMIC ENGINE]
    else {
                    if (item.isCustomText || String(item.type || '').toUpperCase() === 'CUSTOM_TEXT') {
                        const customBody = String(item.message || item.rawText || '').trim();
                        if (customBody.length > 0) {
                            try { await sock.sendPresenceUpdate('composing', jid); } catch (e) {}
                            await new Promise(r => setTimeout(r, 800));
                            try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}
                            await sock.sendMessage(jid, { text: customBody });
                        }
                    } else {
                    const msgType = String(item.msgType || item.type || 'TEXT').toUpperCase();
                    const textBody = (item.message && item.message.trim().length > 0) ? item.message : (item.rawText || '');
                    const cleanRawText = item.rawText || item.message || '';
                    const noticeHeading = item.noticeTitle || 'OFFICIAL NOTICE / आवश्यक सूचना';
                    const recipientName = item.name || item.studentName || 'अभिभावक / शिक्षक';
                    const todayStr = item.date || new Date().toLocaleDateString('en-GB');

                    // 🎯 1. लाइव टाइपिंग सिमुलेशन (Demonstration & Anti-Ban Indicator)
                    try {
                        await sock.sendPresenceUpdate('composing', jid);
                        await new Promise(r => setTimeout(r, 1500));
                        await sock.sendPresenceUpdate('paused', jid);
                    } catch (presenceErr) {}

                    // 🎙️ 1. VOICE BROADCAST (Swara Neural HD Voice)
                    if (msgType === 'VOICE') {
                        const voiceScript = (item.voiceText && item.voiceText.trim().length > 0)
                            ? item.voiceText
                            : `आदरणीय ${recipientName} जी, सादर प्रणाम। जे आर डी पब्लिक स्कूल मरुई द्वारा आवश्यक सूचना: ${cleanRawText}। धन्यवाद!`;

                        let audioBuffer = null;
                        try {
                            audioBuffer = await generateHindiVoiceNote(voiceScript);
                        } catch (vErr) {
                            console.error(`⚠️ Voice generation error for ${item.number}:`, vErr.message);
                        }

                        if (audioBuffer) {
                            await sock.sendMessage(jid, { 
                                audio: audioBuffer, 
                                mimetype: 'audio/ogg; codecs=opus', 
                                ptt: true 
                            });
                        } else {
                            // फॉलबैक: यदि ऑडियो रेंडर न हो पाए तो टेक्स्ट डिलीवर करें
                            await sock.sendMessage(jid, { text: textBody });
                        }
                    }
                    // 📄 2. PDF NOTICE BROADCAST (Official A4 Letterhead Engine)
                    else if (msgType === 'PDF' || msgType === 'DOCUMENT') {
                        let pdfBuffer = null;
                        try {
                            pdfBuffer = await buildOfficialNoticePdfBuffer(noticeHeading, cleanRawText, recipientName, todayStr);
                        } catch (pErr) {
                            console.error(`⚠️ PDF build error for ${item.number}:`, pErr.message);
                        }

                        if (pdfBuffer) {
                            await sock.sendMessage(jid, {
                                document: pdfBuffer,
                                mimetype: 'application/pdf',
                                fileName: `JRD_Notice_${Date.now()}.pdf`,
                                caption: textBody
                            });
                        } else {
                            // फॉलबैक: पीडीएफ न बनने की स्थिति में टेक्स्ट भेजें
                            await sock.sendMessage(jid, { text: textBody });
                        }
                    }
                                     // 💬 3. TEXT BROADCAST (Full VIP School Template)
                    else {
                        if (textBody && textBody.trim().length > 0) {
                            await sock.sendMessage(jid, { text: textBody });
                        }
                    }
                    } // ← isCustomText ke else ka band
                } // ← E. BROADCAST ke else ka band (yeh wala missing tha)
            } else {
                throw new Error('WhatsApp सॉकेट तैयार नहीं था, पुनः प्रयास के लिए रखा गया');
            } // if (sock && ...) बंद
        } catch (err) {
            sendFailed = true;
            console.error(`❌ [त्रुटि] ऑटो संदेश विफल (${item.number}):`, err.message);
        } finally {
            messageQueue.shift();
           if (sendFailed) {
                item._retries = (item._retries || 0) + 1;
                if (!skipRetry && item._retries <= 2) {
                    console.log(`🔄 पुनः प्रयास (${item._retries}/2) के लिए कतार में वापस डाला: ${item.number}`);
                    messageQueue.push(item);
                } else {
                    failedAlertsLog.push({
                        time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                        number: item.number,
                        name: item.studentName || item.name || '',
                        type: item.type,
                        reason: failReason || '3 प्रयासों के बाद विफल'
                    });
                    if (failedAlertsLog.length > 100) failedAlertsLog.shift();
                    console.error(`🛑 संदेश विफल (${failReason || '3 प्रयास'}): ${item.number} (${item.studentName || item.name || ''})`);
                }
            }
            saveQueueToDisk();

            // 🎯 स्मार्ट Anti-Ban गैप: सिर्फ मैसेज जाने या रीट्राई पर ही इंतज़ार करें (गैर-WhatsApp पर समय न गवाएँ)
            if (messageQueue.length > 0 && !skipRetry) {
                const isFeeReminder = (item.type === 'FEE_REMINDER_COMBO');
                const minDelay = isFeeReminder ? 45000 : 20000;
                const maxDelay = isFeeReminder ? 60000 : 30000;
                const waitTime = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                console.log(`⏱️ [${item.type}] पूरा। अगला संदेश ${Math.round(waitTime / 1000)} सेकंड बाद... (पेंडिंग: ${messageQueue.length})`);
                await new Promise(res => setTimeout(res, waitTime));
            }
        }
    } // while (messageQueue.length > 0) बंद
    isProcessingQueue = false;
} // processQueue फ़ंक्शन बंद
app.post('/enqueue-message', (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile || body.to;

    if (!targetPhone) {
        return res.status(400).json({ status: 'error', message: 'Missing phone/number field' });
    }

    const stData = body.studentData || {};
    const fStruct = body.feeStructure || {};

   messageQueue.push({
        number: targetPhone.toString(),
        message: body.message || "",
        type: body.type || body.action || 'GENERAL',
        msgType: body.msgType || body.type || 'TEXT',
        rawText: body.rawText || body.message || '',
        noticeTitle: body.noticeTitle || '',
        action: body.action || body.type || '',
        name: body.name || body.teacher_name || body.student_name || body.studentName || stData.name || '',
        studentName: body.studentName || body.name || body.student_name || stData.name || '',
        className: body.className || body.class || stData.class || '',
        fromClass: body.fromClass || body.from_class || stData.from_class || '',
        session: body.session || body.session_year || stData.session_year || '2026-27',
        rid: body.rid || body.receipt_no || '',
        scholarNo: body.scholarNo || body.scholar_no || body.enroll || stData.scholar_no || stData.enroll || '',
        enroll: body.enroll || stData.enroll || body.scholarNo || '',
        fatherName: body.fatherName || body.father || stData.father || '',
        motherName: body.motherName || body.mother || stData.mother || '',
        studentType: body.studentType || body.student_type || body.status || stData.type || 'REGULAR',
        paid: body.paid || body.amount || 0,
        totalAmount: body.totalAmount || fStruct.grand_total || fStruct.total_amount || 0,
        feeStructure: Object.keys(fStruct).length > 0 ? fStruct : body,
        voiceText: body.voiceText || '',
        // 🟢 टीचर वेलकम ऑडियो और पीडीएफ हेतु जोड़े गए पैरामीटर्स
        audio_url: body.audio_url || body.voice_url || '',
        pdf_url: body.pdf_url || body.document_url || '',
        filename: body.filename || body.pdf_name || `Joining_Letter_${body.teacher_id || 'Teacher'}.pdf`,
        upiLink: body.upiLink || '',
        qrUrl: body.qrUrl || '',
        details: body.details || '',
        breakdown: Array.isArray(body.breakdown) ? body.breakdown : []
    });
  saveQueueToDisk();
    processQueue();

    return res.status(200).json({ status: 'queued', queue_length: messageQueue.length });
});
// 🚀 ENTERPRISE BULK QUEUE: Poori class ka marks data ek sath lekar memory queue me daalega
app.post('/enqueue-bulk-marks', (req, res) => {
    try {
        const list = req.body?.students || [];
        console.log(`📥 [Bulk Route Hit] Total items received: ${list.length}`);

        if (!Array.isArray(list) || list.length === 0) {
            return res.status(400).json({ status: 'ERROR', message: 'No students data found' });
        }

        let queuedCount = 0;
        list.forEach(item => {
            const rawPhone = item.phone || item.number || item.mobile;
            if (!rawPhone) return;

            // 🎯 Phone number ko strictly clean karein aur 91 ensure karein
            let formattedNumber = rawPhone.toString().replace(/[^0-9]/g, '');
            if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;

            messageQueue.push({
                number: formattedNumber,
                message: item.message || "",
                voiceText: item.voiceText || "",
                type: item.type || "SUBJECT_MARKS_ALERT",
                name: item.name || item.studentName || ""
            });
            queuedCount++;
        });

        console.log(`✅ [Bulk Marks Engine] ${queuedCount} alerts queued. Total Queue Length: ${messageQueue.length}`);

        // Background asynchronous queue start
        saveQueueToDisk();    
        processQueue();

        return res.status(200).json({ 
            status: 'SUCCESS', 
            queued: queuedCount, 
            total_pending: messageQueue.length 
        });
    } catch (err) {
        console.error('❌ Bulk Marks Queue Error:', err.message);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});
app.post('/send-whatsapp', (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile || body.to;
    const message = body.message;

    if (!targetPhone || !message || !String(message).trim()) {
        return res.status(400).json({ status: 'error', message: 'Missing params' });
    }

    const formattedNumber = normalizeIndianPhone(targetPhone.toString());
    if (!formattedNumber) {
        return res.status(400).json({ status: 'error', message: 'Invalid phone number' });
    }

    const lockedText = String(message);
    messageQueue.push({
        number: formattedNumber,
        message: lockedText,
        rawText: lockedText,
        type: 'CUSTOM_TEXT',
        msgType: 'CUSTOM_TEXT',
        isCustomText: true,
        qrUrl: '',
        upiLink: '',
        voiceText: '',
        name: body.name || body.studentName || ''
    });

    saveQueueToDisk();
    processQueue();

    return res.status(200).json({
        status: 'success',
        queued: true,
        queue_length: messageQueue.length
    });
});
app.get('/qr', (req, res) => {
    if (isBotReady) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px; color:green;">✅ JRD VIP ERP व्हाट्सएप बोट कनेक्टेड है!</h2>');
    }
    if (!currentQrCode) {
        return res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">QR Code तैयार हो रहा है... कृपया 3 सेकंड बाद Refresh करें।</h2>');
    }
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQrCode)}`;
    res.send(`
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
            <h2>🏫 JRD Public School VIP ERP Bot</h2>
            <p>अपने व्हाट्सएप से इस QR कोड को स्कैन करें:</p>
            <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 2px solid #333; padding: 10px; border-radius: 10px; width: 300px; height: 300px;"/>
            <br>
            <p><a href="/reset-qr?confirm=JRD2026" style="color:red; font-weight:bold;">🔄 नया QR Code बनाएँ (Force Reset)</a></p>
        </div>
    `);
});

app.get('/reset-qr', (req, res) => {
    if (req.query.confirm !== 'JRD2026') {
        return res.status(403).send('<h3>⚠️ Reset karne ke liye /reset-qr?confirm=JRD2026 kholein.</h3>');
    }
    forceClearAuthFolder();
    isBotReady = false;
    isConnecting = false;
    currentQrCode = '';
    setTimeout(() => startBot(true), 1000);
    res.send('<h2 style="font-family:sans-serif; text-align:center; margin-top:50px;">🧹 पुराना सेशन साफ़ कर दिया गया है! <a href="/qr">/qr पेज खोलें</a>।</h2>');
});

app.get('/clear-lid-cache', (req, res) => {
    try {
        if (fs.existsSync(LID_MAP_FILE)) {
            fs.unlinkSync(LID_MAP_FILE);
            lidPhoneMap = {};
            return res.send('✅ LID cache cleared.');
        }
        res.send('ℹ️ Cache file already absent.');
    } catch (e) {
        res.status(500).send('❌ Error: ' + e.message);
    }
});

app.get('/test-voice2', async (req, res) => {
    const out = { steps: [] };
    const log = (s) => out.steps.push(s);
    try {
        const { EdgeTTS } = await import('edge-tts-universal');
        log('import OK');
        const tts = new EdgeTTS('नमस्ते, यह जांच है।', 'hi-IN-SwaraNeural');
        const result = await tts.synthesize();
        const mp3 = Buffer.from(await result.audio.arrayBuffer());
        log('MP3 bytes: ' + mp3.length);
        log(mp3.length > 1000 ? '✅ TTS OK' : '❌ audio khali');
    } catch (e) {
        log('❌ FAIL: ' + e.message);
    }
    res.json(out);
});
// 🔧 VOICE DEBUG ROUTE: browser mein /test-voice kholo
app.get('/test-voice', async (req, res) => {
    const out = { steps: [] };
    const log = (s) => out.steps.push(s);

    try {
        try { log('msedge-tts version: ' + require('msedge-tts/package.json').version); } catch (e) { log('version padh nahi paya'); }
        log('ffmpegPath: ' + (ffmpegPath || 'NULL'));

        // STEP 1: TTS
        const tts = new MsEdgeTTS();
        await tts.setMetadata(HINDI_FEMALE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        log('setMetadata OK');

        const r = await tts.toStream('नमस्ते, यह जांच है।');
        const stream = (r && r.audioStream) ? r.audioStream : r;
        log('toStream OK, keys: ' + Object.keys(r || {}).join(','));

        const chunks = [];
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout 20s')), 20000);
            stream.on('data', c => chunks.push(Buffer.from(c)));
            stream.on('end', () => { clearTimeout(t); resolve(); });
            stream.on('close', () => { clearTimeout(t); resolve(); });
            stream.on('error', e => { clearTimeout(t); reject(e); });
        });
        const mp3 = Buffer.concat(chunks);
        log('MP3 bytes: ' + mp3.length);
        if (mp3.length < 1000) throw new Error('MP3 khali aaya');

        // STEP 2: ffmpeg
        const mp3Path = path.join(os.tmpdir(), 'test_voice.mp3');
        const oggPath = path.join(os.tmpdir(), 'test_voice.ogg');
        fs.writeFileSync(mp3Path, mp3);
        await new Promise((resolve, reject) => {
            ffmpeg(mp3Path).noVideo().audioCodec('libopus').audioChannels(1)
                .audioFrequency(48000).audioBitrate('32k').format('ogg')
                .on('end', resolve).on('error', reject).save(oggPath);
        });
        log('OGG bytes: ' + fs.statSync(oggPath).size);
        log('✅ SAB OK: voice ban rahi hai');
    } catch (e) {
        log('❌ FAIL: ' + e.message);
    }
    res.json(out);
});
// 💳 UPI पेमेंट रीडायरेक्ट पेज (WhatsApp लिंक -> UPI ऐप)
app.get('/pay', (req, res) => {
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const am = Math.max(1, parseInt(req.query.am, 10) || 1);
    const upi = 'upi://pay?pa=' + encodeURIComponent(req.query.pa || '') +
                '&pn=' + encodeURIComponent(req.query.pn || '') +
                '&am=' + am + '&cu=INR&tn=' + encodeURIComponent(req.query.tn || '');
    res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="font-family:sans-serif;text-align:center;padding:40px">' +
        '<h3>' + esc(req.query.pn) + '</h3><p>Fees: ₹' + am + '</p>' +
        '<a href="' + esc(upi) + '" style="display:inline-block;padding:14px 28px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-size:18px">UPI se pay karein</a>' +
        '<script>location.href=' + JSON.stringify(upi).replace(/</g, '\\u003c') + '</script></body>');
});
// 📊 लाइव क्यू मॉनिटर (/queue-status खोलकर देखें कितने मैसेज बाकी हैं)
app.get('/queue-status', (req, res) => {
    res.json({
        bot_ready: isBotReady,
        processing: isProcessingQueue,
        pending_count: messageQueue.length,
        next_student: messageQueue[0] ? (messageQueue[0].studentName || messageQueue[0].name || messageQueue[0].number) : 'None',
        failed_count: failedAlertsLog.length,
        failed_list: failedAlertsLog
    });
});
app.get('/', (req, res) => {
    res.send(`JRD WhatsApp Bot Status: ${isBotReady ? 'Connected ✅' : 'Waiting for QR scan ⏳'}`);
});

// ⚡ Self-Ping Interval (Server को एक्टिव रखने हेतु)
setInterval(() => {
    https.get('https://mp7k2cqazf71-production-noqbsigv.us-central1.suga.run/', (res) => {
        res.resume(); // 🧹 सॉकेट और मेमोरी लीक से 100% सुरक्षा
        console.log('⚡ Self-Ping successful');
    }).on('error', (err) => {
        console.error('❌ Self-Ping error:', err.message);
    });
}, 4 * 60 * 1000);

// 🧹 हर 6 घंटे में कैश सफाई (24/7 सर्वर पर RAM लीक से सुरक्षा)
setInterval(() => {
    msgRetryCounterCache.clear();
    const now = Date.now();
    for (const [k, exp] of pausedChats.entries()) {
        if (now >= exp) pausedChats.delete(k);
    }
}, 6 * 60 * 60 * 1000);

// 🎙️ TEACHER & STUDENT LIVE ATTENDANCE API WITH 1-31 QUOTES
app.post('/send-attendance', async (req, res) => {
    const body = req.body || {};
    const targetPhone = body.number || body.phone || body.mobile;
    const name = body.name || body.teacher_name || 'शिक्षक';
    const status = (body.status || 'PRESENT').toString().toUpperCase().trim();
    const className = body.class || body.class_name || '';
    const type = body.type || 'STUDENT_ATTENDANCE';
    const attType = (body.attendance_type || body.att_type || 'IN').toString().toUpperCase().trim();

    if (!targetPhone) {
        return res.status(400).json({ status: 'error', message: 'Missing phone number' });
    }

    let rawTime = String(body.time || body.in_time || body.out_time || '').trim();
    let cleanTime = '';

    if (rawTime.includes('1899') || rawTime.includes('GMT') || rawTime.includes('T') || rawTime === '' || rawTime === '--') {
        cleanTime = new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } else {
        cleanTime = rawTime;
    }

    let todayStr = new Date().toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    const dayOfMonth = parseInt(new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }), 10) || 1;
    const todayInQuote = inQuotes[dayOfMonth] || inQuotes[1];
    const todayOutQuote = outQuotes[dayOfMonth] || outQuotes[1];

    try {
       let formattedNumber = targetPhone.toString().replace(/[^0-9]/g, '');
        if (formattedNumber.length === 10) formattedNumber = '91' + formattedNumber;
        const jid = formattedNumber + '@s.whatsapp.net';

        let messageText = "";
        let voiceScriptText = "";

        if (type === 'TEACHER_ATTENDANCE') {
            if (status === 'ABSENT' || status === 'A') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ *अनुपस्थिति सूचना (TEACHER ABSENT)*\n\nआदरणीय *${name}* जी,\nआज विद्यालय में आपकी स्थिति **अनुपस्थित (ABSENT)** दर्ज की गई है।\n\n_कृपया अपनी नियमित उपस्थिति बनाए रखें ताकि पठन-पाठन सुचारू रूप से चल सके।_\n━━━━━━━━━━━━━━━━━━━━━━━\n– Er. Sarvesh Verma (Management)`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई प्रबंधन द्वारा सूचित किया जाता है कि आज विद्यालय में आपकी स्थिति अनुपस्थित दर्ज की गई है। कृपया अपनी नियमित उपस्थिति बनाए रखें ताकि पठन-पाठन सुचारू रूप से चल सके। धन्यवाद!`;
            } else if (attType === 'OUT') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n🚩 *शिक्षक प्रस्थान (OUT-TIME)*\n\nआदरणीय *${name}* जी,\n\n🕒 *प्रस्थान समय:* ${cleanTime}\n🏁 *स्थिति:* कार्य दिवस पूर्ण ✅\n\n🌺 *आज का आभार संदेश:*\n_"${todayOutQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई में आपका आज का प्रस्थान समय ${cleanTime} बजे सफलतापूर्वक दर्ज कर लिया गया है। ${todayOutQuote} धन्यवाद!`;
            } else if (attType === 'IN') {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n📋 *शिक्षक उपस्थिति (IN-TIME)*\n\nआदरणीय *${name}* जी,\nविद्यालय में आपका हार्दिक स्वागत है!\n\n🕒 *आगमन समय:* ${cleanTime}\n✅ *स्थिति:* PRESENT (उपस्थित)\n\n💭 *आज का प्रेरणादायी विचार:*\n_"${todayInQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई परिवार में आपका हार्दिक स्वागत है। आपका आगमन समय ${cleanTime} बजे दर्ज हो गया है। ${todayInQuote} आपका दिन शुभ हो!`;
            } else {
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n📅 *दिनांक:* ${todayStr}\n━━━━━━━━━━━━━━━━━━━━━━━\n✅ *उपस्थिति सूचना (PRESENT)*\n\nआदरणीय *${name}* जी,\nआज विद्यालय में आपकी उपस्थिति (**PRESENT**) दर्ज कर ली गई है।\n\n💭 *आज का विचार:*\n_"${todayInQuote}"_\n━━━━━━━━━━━━━━━━━━━━━━━\n– JRD Management`;
                voiceScriptText = `नमस्ते! आदरणीय ${name} जी, जे आर डी पब्लिक स्कूल मरुई में आज आपकी उपस्थिति सफलतापूर्वक दर्ज कर ली गई है। ${todayInQuote} धन्यवाद!`;
            }
       } else {
            // 🎯 1. स्टेटस को साफ-सुथरा ट्रिम करना (ताकि स्पेस की वजह से फेल न हो)
            const cleanSt = String(status || '').trim().toLowerCase();
            
            // 🎯 2. लीव और एब्सेंट की पक्की पहचान
            const isLeave  = (cleanSt === 'leave' || cleanSt === 'l' || cleanSt.indexOf('अवकाश') !== -1 || cleanSt.indexOf('leave') !== -1);
            const isAbsent = !isLeave && (cleanSt === 'absent' || cleanSt === 'a' || cleanSt.indexOf('अनुपस्थित') !== -1);

            // क्लास से फालतू शब्द साफ करना
            const cleanClass = String(className || '')
                .replace(/class/gi, '')
                .replace(/कक्षा/gi, '')
                .replace(/th|st|nd|rd/gi, '')
                .trim() || className;

            const todayStudentQuote = (typeof studentQuotes !== 'undefined' && studentQuotes[dayOfMonth]) ? studentQuotes[dayOfMonth] : "परिश्रम ही सफलता की असली कुंजी है।";
            const todayAbsentQuote  = (typeof absentQuotes !== 'undefined' && absentQuotes[dayOfMonth]) ? absentQuotes[dayOfMonth] : "नियमितता ही सफलता की नींव है।";
            const todayLeaveQuote   = (typeof leaveQuotes !== 'undefined' && leaveQuotes[dayOfMonth]) ? leaveQuotes[dayOfMonth] : "स्वास्थ्य और विश्राम भी जीवन की ऊर्जा को बनाए रखने के लिए आवश्यक है।";

            if (isLeave) {
                // 🏖️ 1. LEAVE TEXT (टेक्स्ट में पूरा विचार जाएगा)
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                              `📅 *दिनांक:* ${todayStr}\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `🏖️ *दैनिक अवकाश सूचना (LEAVE)*\n\n` +
                              `आदरणीय अभिभावक जी,\n` +
                              `सादर प्रणाम।\n\n` +
                              `आपको सादर सूचित किया जाता है कि आपके प्रिय पाल्य:\n\n` +
                              `👤 *विद्यार्थी:* *${name}*\n` +
                              `📚 *कक्षा:* ${cleanClass}\n` +
                              `📊 *स्थिति:* स्वीकृत अवकाश (LEAVE) 🏖️\n\n` +
                              `का आज का अवकाश प्रार्थना-पत्र विद्यालय रिकॉर्ड में दर्ज/स्वीकृत कर लिया गया है।\n\n` +
                              `📖 *आज का विचार:*\n` +
                              `_"${todayLeaveQuote}"_\n\n` +
                              `👉 _कृपया अवकाश अवधि में भी बच्चे के नियमित स्वाध्याय एवं गृहकार्य पर विशेष ध्यान दें।_\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `– JRD Management`;

                // 🎙️ 2. LEAVE VOICE (बिना भारी कोटेशन के साफ़ और डायरेक्ट स्क्रिप्ट - कभी फेल नहीं होगी)
                voiceScriptText = `नमस्ते! आदरणीय अभिभावक जी, सादर प्रणाम। जे आर डी पब्लिक स्कूल मरुई द्वारा सूचित किया जाता है कि आपके प्रिय पाल्य ${name}, कक्षा ${cleanClass}, का आज का अवकाश विद्यालय रिकॉर्ड में स्वीकृत कर लिया गया है। कृपया घर पर बच्चे के स्वाध्याय पर ध्यान दें। धन्यवाद!`;

            } else if (isAbsent) {
                // 🔴 ABSENT TEXT
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                              `📅 *दिनांक:* ${todayStr}\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `⚠️ *दैनिक उपस्थिति सूचना (ABSENT)*\n\n` +
                              `आदरणीय अभिभावक जी,\n` +
                              `सादर प्रणाम।\n\n` +
                              `आपको अत्यंत विनम्रतापूर्वक सूचित किया जाता है कि आपके प्रिय पाल्य:\n\n` +
                              `👤 *विद्यार्थी:* *${name}*\n` +
                              `📚 *कक्षा:* ${cleanClass}\n` +
                              `📊 *स्थिति:* अनुपस्थित (ABSENT) ❌\n\n` +
                              `आज विद्यालय में उपस्थित नहीं हैं।\n\n` +
                              `📖 *आज का अनुशासन विचार:*\n` +
                              `_"${todayAbsentQuote}"_\n\n` +
                              `✍️ *विशेष आग्रह:*\n` +
                              `_कृपया पाल्य के विद्यालय न आने का उचित कारण विद्यालय कार्यालय में अवश्य सूचित करने का कष्ट करें ताकि इनकी निरंतर पढ़ाई प्रभावित न हो।_\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `– JRD Management`;

                // 🎙️ ABSENT VOICE
                voiceScriptText = `नमस्ते! आदरणीय अभिभावक जी, सादर प्रणाम। जे आर डी पब्लिक स्कूल मरुई द्वारा सूचित किया जाता है कि आपके प्रिय पाल्य ${name}, कक्षा ${cleanClass}, आज विद्यालय में अनुपस्थित हैं। कृपया अनुपस्थिति का कारण विद्यालय कार्यालय में सूचित करें। धन्यवाद!`;

            } else {
                // 🟢 PRESENT TEXT & VOICE
                messageText = `🏫 *J.R.D. PUBLIC SCHOOL, मरुई*\n` +
                              `📅 *दिनांक:* ${todayStr}\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `✅ *दैनिक उपस्थिति सूचना (PRESENT)*\n\n` +
                              `आदरणीय अभिभावक जी,\n` +
                              `सादर प्रणाम।\n\n` +
                              `हमें आपको सूचित करते हुए अत्यंत हर्ष हो रहा है कि आपके प्रिय पाल्य:\n\n` +
                              `👤 *विद्यार्थी:* *${name}*\n` +
                              `📚 *कक्षा:* ${cleanClass}\n` +
                              `📊 *स्थिति:* उपस्थित (PRESENT) ✅\n\n` +
                              `आज विद्यालय में समय से उपस्थित हैं।\n\n` +
                              `📖 *आज का प्रेरक विचार:*\n` +
                              `_"${todayStudentQuote}"_\n\n` +
                              `👉 _कृपया घर पर भी इनके दैनिक अध्ययन एवं गृहकार्य पर विशेष ध्यान दें।_\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `– JRD Management`;

                voiceScriptText = `आदरणीय अभिभावक जी, सादर प्रणाम। जे आर डी पब्लिक स्कूल में आज आपके प्रिय पाल्य ${name}, कक्षा ${cleanClass}, समय से उपस्थित हैं। आज का प्रेरक विचार: ${todayStudentQuote}। कृपया घर पर भी इनके नियमित अध्ययन और गृहकार्य पर ध्यान दें। धन्यवाद!`;
            }
        }

      // 🎯 सीधे भेजने के बजाय सेफ कतार (Queue) में पुश करें
        messageQueue.push({
            number: targetPhone.toString(),
            name: name,
            message: messageText,
            voiceText: voiceScriptText,
            type: 'ATTENDANCE_ALERT',
            attendance_id: body.attendance_id || null
        });

        saveQueueToDisk();
        processQueue();

        return res.status(200).json({ status: 'success', message: 'Attendance message queued safely' });
    } catch (error) {
        console.error('❌ Attendance sending error:', error.message);
        return res.status(500).json({ status: 'error', message: error.toString() });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`JRD VIP ERP Bot running on 0.0.0.0:${PORT}`);
});

startBot();
