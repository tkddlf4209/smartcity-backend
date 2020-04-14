var express = require('express'); // web server
//var mysql = require('mysql2/promise');
var router = express.Router();
var Request = require('request-promise'); // rest api
var moment = require('moment'); // date format
var fs = require('fs');
var path = require('path');
const util = require('util');
const mysql = require('mysql2'); // mysql con driver , Mysql2 can use Connection Pool.

// TYPE CHECK STANDARD
// 수신불량 판단 기준 (30분)
const TIME_LIMIT = 1000 * 60 * 30;
// 배터리부족 판단 기준 (20%이하) 
const BATTERY_LIMIT = 20;


// 1 고정형 , 2 이동형
const TYPE_FIXED = 1;
const TYPE_MOVEMENT = 2;

// 1 정상 , 2 수신불량 , 3 배터리부족
const STATUS_NORMAL = 1;
const STATUS_BORKEN = 2;
const STATUS_BATTERY = 3;


// search from elasticSearch
// 1 LTE , 2 LORA , 3 NBIOT
const MODULE_TYPE_LTE = 1;
const MODULE_TYPE_LORA = 2;
const MODULE_TYPE_NBIOT = 3;

// 1: 이동공유시설물서비스 관련 DB(MySql) , 2 : 대기품질서비스 관련 DB(ElasticSearch)
const DB_TYPE_MYSQL = 1;
const DB_TYPE_ELASTICSEARCH = 2;


// ElasticSearch Address
const ELK_URL = "192.168.3.158:9200"
const ELK_NODE_NAME = "Et8WQxJnTJWEL-gCMvUbgw"


// Create the connection pool. The pool-specific settings are the defaults
const pool = mysql.createPool({
    host: '118.131.116.84',
    port: 33306,
    user: 'smartcity',
    password: '*smartcity*',
    database: 'smartcity',
    waitForConnections: true,
    connectionLimit: 100,
    queueLimit: 0
});

// const pool = mysql.createPool({
//     host: '127.0.0.1',
//     port: 3306,
//     user: 'smartcity',
//     password: '*smartcity*',
//     database: 'smartcity',
//     waitForConnections: true,
//     connectionLimit: 100,
//     queueLimit: 0
// });
//const ELK_URL = "10.20.1.137:9200"

module.exports = router;
pool.getConnection(function (err, con) {

    if (err) {
        console.error(err);
        return;
    }

    updateNetworkResource(con);
    updateElkDatabaseResource(con);
    updateMysqlDatabaseResource(con);
    pool.releaseConnection(con);

    setInterval(() => {

        pool.getConnection(function (err, conn) {
            if (err) {
                console.error(err);
                return;
            }

            updateNetworkResource(conn);
            updateMysqlDatabaseResource(conn);
            updateElkDatabaseResource(conn);
            pool.releaseConnection(conn);

        })

    }, 10000)

})


var latest_lte_total_count = 0;
var latest_lora_total_count = 0;
function updateNetworkResource(con) {
    // lte traffic
    options = {
        method: 'GET',
        url: 'http://' + ELK_URL + '/v2-logstash-smart-sensor-*/_count',
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        json: true
    }

    Request(options, function (error, response, body) {
        if (error) throw new Error(error);
        var lte_total_count = body.count;

        if (latest_lte_total_count === 0) {
            latest_lte_total_count = lte_total_count;
        } else {
            if ((lte_total_count - latest_lte_total_count) < 0) { // 데이터가 삭제되서 total count 가 줄어든 경우 다시 최근값을 초기화한다.
                latest_lte_total_count = lte_total_count
            } else {
                var query = util.format(" INSERT INTO 5g_dashboard_module_traffic(time_stamp,module_type,add_count,total_count) values (now(),%s,%s,%s)"
                    , MODULE_TYPE_LTE, lte_total_count - latest_lte_total_count, lte_total_count);

                pool.query(query, function (err, rows) {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    //console.log(rows);
                });
            }
        }
        latest_lte_total_count = lte_total_count;
    });


    // lora traffic
    var query = util.format(" SELECT count(*) count from lora_test");

    pool.query(query, function (err, rows) {
        if (err) {
            console.error(err);
            return;
        }

        if(rows.count == 0){
            return
        }
        
        var lora_total_count = rows[0].count;
        
        if (latest_lora_total_count === 0) {
            latest_lora_total_count = lora_total_count;
        } else {
            if ((lora_total_count - latest_lora_total_count) < 0) { // 데이터가 삭제되서 total count 가 줄어든 경우 다시 최근값을 초기화한다.
                latest_lora_total_count = lora_total_count
            } else {
                var query = util.format(" INSERT INTO 5g_dashboard_module_traffic(time_stamp,module_type,add_count,total_count) values (now(),%s,%s,%s)"
                    , MODULE_TYPE_LORA, lora_total_count - latest_lora_total_count, lora_total_count);

                pool.query(query, function (err, rows) {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    //console.log(rows);
                });
            }
        }
        latest_lora_total_count = lora_total_count;
        

        //console.log(rows);
    });


}

var elk_total_con_count = 0;
var elk_total_transaction_count = 0;
async function updateElkDatabaseResource(con) {
    // get elk con count 
    var options;
    var total_con_count;
    var total_transaction_count;
    var response;

    options = {
        method: 'GET',
        url: 'http://' + ELK_URL + '/_nodes/stats',
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        json: true
    }

    try {
        response = await Request(options);
        total_con_count = response.nodes[ELK_NODE_NAME].http.total_opened;
        total_transaction_count = response.nodes[ELK_NODE_NAME].indices.search.query_total;

    } catch (e) {
        return;
    }

    if (elk_total_con_count == 0 || elk_total_transaction_count == 0) {
        elk_total_con_count = total_con_count
        elk_total_transaction_count = total_transaction_count
    } else {
        if ((total_transaction_count - elk_total_transaction_count) < 0 || (total_con_count - elk_total_con_count) < 0) { // 데이터가 삭제되서 total count 가 줄어든 경우 다시 최근값을 초기화한다.
            elk_total_transaction_count = total_transaction_count
            elk_total_con_count = total_con_count
        } else {
            var query = util.format(" INSERT INTO 5g_dashboard_db_info(time_stamp,db_type,increase_con_count,total_con_count,increase_transaction_count,total_transaction_count) values (now(),%s,%s,%s,%s,%s)",
                DB_TYPE_ELASTICSEARCH,
                total_con_count - elk_total_con_count,
                total_con_count,
                total_transaction_count - elk_total_transaction_count,
                total_transaction_count);

            pool.query(query, function (err, rows) {
                if (err) {
                    console.error(err);
                    return;
                }

                elk_total_con_count = total_con_count
                elk_total_transaction_count = total_transaction_count
            });

        }

    }

    // var query = util.format(" INSERT INTO 5g_dashboard_module_traffic(time_stamp,module_type,add_count,total_count) values (now(),%s,%s,%s)"
    //                 , MODULE_TYPE_LTE, total_count - latest_total_count, total_count);

    //             con.query(query, function (err, rows) {
    //                 if (err) throw err;
    //                 console.log(rows);
    //             });
}


var mysql_total_con_count = 0;
var mysql_total_transaction_count = 0;
async function updateMysqlDatabaseResource(con) {

    // Transcation count
    var query = "SHOW ENGINE INNODB STATUS"
    pool.query(query, function (err, rows) {
        if (err) {
            console.error(err);
            return;
        }

        var temp = rows[0].Status.split('Trx id counter')[1];
        var total_transaction_count = parseInt(temp.substring(0, temp.indexOf('\n')));

        query = "show status like 'Connections'"
        pool.query(query, function (err, rows) {
            if (err) {
                console.error(err);
                return;
            }

            var total_con_count = parseInt(rows[0].Value);

            if (mysql_total_con_count == 0 || mysql_total_transaction_count == 0) {
                mysql_total_con_count = total_con_count
                mysql_total_transaction_count = total_transaction_count
            } else {
                var query = util.format(" INSERT INTO 5g_dashboard_db_info(time_stamp,db_type,increase_con_count,total_con_count,increase_transaction_count,total_transaction_count) values (now(),%s,%s,%s,%s,%s)",
                    DB_TYPE_MYSQL,
                    total_con_count - mysql_total_con_count,
                    total_con_count,
                    total_transaction_count - mysql_total_transaction_count,
                    total_transaction_count);

                pool.query(query, function (err, rows) {
                    if (err) {
                        console.error(err);
                        return;
                    }


                    mysql_total_con_count = total_con_count
                    mysql_total_transaction_count = total_transaction_count
                });
            }

        });
    });




}


/* router.get('/db_info/:id', async function (req, res, next) {

    var db_type;
    if (req.params.id == 'mysql') {
        db_type = DB_TYPE_MYSQL;
    } else { // elk : elatic search 
        db_type = DB_TYPE_ELASTICSEARCH;
    }

    var query = "SELECT FLOOR(UNIX_TIMESTAMP(time_stamp)/(10 * 60)) AS timekey , " +
        " SUBSTRING(min(time_stamp),11,6) as time_stamp, " +
        " sum(increase_con_count) as increase_con_count, " +
        "max(db_type) as db_type, " +
        " max(total_con_count) as total_con_count, " +
        "sum(increase_transaction_count) as increase_transaction_count, " +
        "max(total_transaction_count) as total_transaction_count " +
        "FROM 5g_dashboard_db_info where db_type="+db_type +" group by timekey, db_type order by timekey desc limit 60 "

    con.query(query, function (err, rows) {
        if (err) throw err;
        res.json(rows.reverse());
    });
}); */

// var Client = require('ftp');
// var c = new Client();
// c.connect({
//     host: "192.168.3.199",
//     user: "kbell",
//     password: "kbell12!@"
// });


function newVersionCheck(preVersion, newVersion) {
    var result = false;
    var currentVersion = preVersion.split("\\.");
    var newVersion = newVersion.split("\\.");
    var len = 3;

    //len =  (currentVersion.length > newVersion.length) ? currentVersion.length : newVersion.length;

    for (var i = 0; i < len; i++) {
        var currentNum = currentVersion[i];
        var newNum = newVersion[i];

        if (currentNum != newNum) {
            if (currentNum < newNum) {
                result = true;
            } else {
                result = false;
            }
            break;
        }
    }
    return result;

}

function checkVersion(device_type, newVersion) {

    let dir = fs.readdirSync(FIRMWARE_PATH + "/" + device_type);
    var highestVersion;
    dir.forEach(file => {
        if (path.extname(file) === ".binary") {
            var fileVersion = file.replace(/\.[^/.]+$/, "").replace("V", ""); //remove .binary extension
            console.log(fileVersion);

            if (highestVersion == undefined) {
                highestVersion = fileVersion
            } else {
                if (newVersionCheck(highestVersion, fileVersion)) {
                    highestVersion = fileVersion;
                }
            }
        }
    })

    if (highestVersion == undefined) {
        return true;
    } else {
        return newVersionCheck(highestVersion, newVersion);
    }
}


let FIRMWARE_PATH = "./firmware";
const multer = require('multer');
var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, FIRMWARE_PATH + "/" + req.body.device_type)
    },
    filename: function (req, file, cb) {
        cb(null, "V" + req.body.version + ".binary");
    }
})
var upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        var result = false;

        if (checkVersion(req.body.device_type, req.body.version)) {
            result = true;
        }

        req.body.result = result;
        cb(null, result);
    }
})


router.post('/firmware_upload', upload.single('binary_file'), async function (req, res, next) {
    console.log(req.body);

    if (req.body.result) {
        res.json(true);
    } else {
        res.json(false);
    }
    //console.log(req.body.version);
    //res.send("ok");
});



var reg = new RegExp('^d{1,2}.d{1,2}.d{1,2}$')
router.get('/firmware_list', async function (req, res, next) {
    //console.log( newVersionCheck('1.0.0','0.1.1'));

    var list = [];

    try {
        if (req.query.device_type != undefined) {
            let dir = fs.readdirSync(FIRMWARE_PATH + "/" + req.query.device_type);

            dir.forEach(file => {
                if (path.extname(file) === ".binary") {
                    var version = file.replace(/\.[^/.]+$/, ""); //remove .binary extension

                    let item = fs.statSync(FIRMWARE_PATH + "/" + req.query.device_type + "/" + file);
                    item.name = file;
                    item.version = version;
                    list.push(item);
                }
            })
        }


        list.sort();
        list.reverse();

        res.json(list);
    } catch (e) {
        res.status(500).send(e)
    }
});

router.get('/firmware_binary', async function (req, res, next) {

    if (req.query.device_type != undefined && req.query.version != undefined) {
        var filePath = FIRMWARE_PATH + "/" + req.query.device_type + "/" + req.query.version + ".binary";

        if (fs.existsSync(filePath)) {
            var text = fs.readFileSync(filePath);
            
            res.send(text);
        } else {
            res.status(500).send('file not exist');
        }
    } else {
        res.status(500).send('device_type or version params not exist');
    }

});

router.get('/firmware_remove', async function (req, res, next) {

    var filePath = FIRMWARE_PATH + "/" + req.query.device_type + "/" + req.query.name;

    try {
        fs.unlinkSync(filePath)
        res.json(true);
    } catch (err) {
        console.error(err)
        res.json(false);
    }

});


router.get('/device_info', async function (req, res, next) {

    options = {
        method: 'GET',
        url: 'http://' + ELK_URL + '/v2-smart-city-sensor-list/_search',
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        body: {
            "query": {
                "bool": {
                    "must": [
                        {
                            "term": {
                                "device_id": {
                                    "value": req.query.device_id
                                }
                            }
                        }
                    ]
                }
            }

        },
        json: true
    }

    try {
        response = await Request(options);


        if (response.hits.hits.length > 0) {
            res.json(response.hits.hits[0]._source)
        } else {
            res.send("");
        }
    } catch (e) {
        console.log(e);
    }
});

router.post('/firmware_update', async function (req, res, next) {

    //res.json(true);
    for (var i = 0; i < req.query.device_list.length; i++) {
        options = {
            method: 'POST',
            url: 'http://' + ELK_URL + '/v2-smart-city-sensor-list/info/' + JSON.parse(req.query.device_list[i]) + '/_update',
            headers:
            {
                'cache-control': 'no-cache',
                'Content-Type': 'application/json'
            },
            body: {
                doc: {
                    "update_version": req.query.version,
                    "update_enable": req.query.firmware_enable
                }
            },
            json: true
        }

        try {
            response = await Request(options);

        } catch (e) {
            console.log(e);
        }
    }

    setTimeout(function () {
        // 값을 변경하는데 시간이 좀 걸리는 듯하다. 응답후 바로 장치 리스트를 재요청할 경우 값이 바로 변경되지 않았다.
        res.json(true);
    }, 1000);

});

router.get('/module_traffic', async function (req, res, next) {
    var module_type =req.query.module_type ;
    
    var query_builder = "";
    for (var i = 30; i >= 0; i--) {
        query_builder += " SELECT CONCAT(LEFT(DATE_FORMAT(DATE_ADD(NOW(), INTERVAL " + (i * - 10) + " MINUTE), '%H:%i'),4),'0') AS time_stamp FROM DUAL ";

        if (i != 0) {
            query_builder += " UNION ALL ";
        }

    }
    var query = util.format(
        " SELECT TT.*, IFNULL(add_count,0) add_count, IFNULL(total_count,0) total_count from ( " +
        " %s " +
        ") TT LEFT JOIN (" +
        " SELECT CONCAT(LEFT(DATE_FORMAT(time_stamp, '%H:%i'),4),'0') time_stamp,  sum(add_count) as add_count, max(total_count) as total_count FROM 5g_dashboard_module_traffic where time_stamp > DATE_ADD(NOW(), INTERVAL -300 MINUTE) and module_type="+module_type+" GROUP BY CONCAT(LEFT(DATE_FORMAT(time_stamp, '%H:%i'),4),'0') " +
        ") DMT ON TT.time_stamp = DMT.time_stamp",
        query_builder
    )

    //SELECT date_format(time_stamp, '%H:%i') as time_stamp , sum(add_count) as add_count, max(total_count) as total_count  FROM 5g_dashboard_module_traffic group by  date_format(time_stamp, '%H:%i')  order by time_stamp limit 30;
    //var query = "SELECT FLOOR(UNIX_TIMESTAMP(time_stamp)/(10 * 60)) AS timekey ,  SUBSTRING(min(time_stamp),11,6) as time_stamp, sum(add_count) as add_count, max(total_count) as total_count  FROM 5g_dashboard_module_traffic group by  timekey order by timekey desc limit 30"
    pool.query(query, function (err, rows) {
        if (err) {
            console.error(err);
            return;
        }

        res.json(rows);
    });

});

router.get('/db_info/:id', async function (req, res, next) {

    var db_type;
    if (req.params.id == 'mysql') {
        db_type = DB_TYPE_MYSQL;
    } else { // elk : elatic search 
        db_type = DB_TYPE_ELASTICSEARCH;
    }

    var query_builder = "";
    for (var i = 30; i >= 0; i--) {
        query_builder += " SELECT CONCAT(LEFT(DATE_FORMAT(DATE_ADD(NOW(), INTERVAL " + (i * - 10) + " MINUTE), '%H:%i'),4),'0') AS time_stamp FROM DUAL ";

        if (i != 0) {
            query_builder += " UNION ALL ";
        }
    }

    var query = util.format("SELECT TT.*, IFNULL(increase_con_count,0) increase_con_count, IFNULL(total_con_count,0) total_con_count, IFNULL(increase_transaction_count,0) increase_transaction_count, IFNULL(total_transaction_count,0) total_transaction_count FROM (" +
        "%s " +
        ") TT LEFT JOIN (" +
        "  SELECT CONCAT(LEFT(DATE_FORMAT(time_stamp, '%H:%i'),4),'0') time_stamp, SUM(increase_con_count) increase_con_count, MAX(total_con_count) total_con_count, SUM(increase_transaction_count) increase_transaction_count, MAX(total_transaction_count) total_transaction_count FROM 5g_dashboard_db_info where" +
        " db_type='" + db_type + "' " +
        " GROUP BY CONCAT(LEFT(DATE_FORMAT(time_stamp, '%H:%i'),4),'0')" +
        ") DDI ON TT.time_stamp = DDI.time_stamp order by TT.time_stamp", query_builder);

    pool.query(query, function (err, rows) {
        if (err) {
            console.error(err);
            return;
        }

        res.json(rows);
    });
});


/* GET users listing. */
router.get('/lora_list', async function (req, res, next) {
    var options = null;
    var response = null;

    options = {
        method: 'POST',
        url: "http://" + ELK_URL + "/v2-smart-city-sensor-list/_search?pretty",
        qs: { pretty: '' },
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        body: { "size": 10000, "query": { "match_all": {} }, "sort": [{ "device_id": { "order": "asc" } }] },
        json: true
    }

    var lora_list = [];
    try {
        response = await Request(options);

        var hits = response.hits.hits;
        
        for(var i = 0; i < hits.length; i++){
            if(hits[i]._id >=60000 && 70000 > hits[i]._id){
                lora_list.push (hits[i]);
            }
        }
        
    } catch (e) {

    }
    res.json(lora_list);

});


/* GET users listing. */
router.get('/device_list', async function (req, res, next) {
    var options = null;
    var response = null;

    options = {
        method: 'POST',
        url: "http://" + ELK_URL + "/v2-smart-city-sensor-list/_search?pretty",
        qs: { pretty: '' },
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        body: { "size": 10000, "query": { "match_all": {} }, "sort": [{ "device_id": { "order": "asc" } }] },
        json: true
    }

    var map = new Map();
    try {
        response = await Request(options);

        var hits = response.hits.hits;
        hits.forEach(item => {
            //console.log(item)
            map.set(item._id, item);
        });
    } catch (e) {

    }

    options = {
        method: 'POST',
        url: 'http://' + ELK_URL + '/v2-logstash-smart-sensor-*/_search?pretty',
        qs: { pretty: '' },
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        body: {
            "size": 0,
            "query": {
                "bool": {
                    "must": [{ "wildcard": { "full_addr": { "value": "*" } } }],
                    "filter": [{ "range": { "time_stamp": { "gte": req.body.gteDate, "lte": req.body.lteDate } } }]
                }
            },
            "aggs": {
                "get_tags": {
                    "terms": { "field": "device_id", "size": 10000, "order": { "_key": "asc" } },
                    "aggs": { "desc_top": { "top_hits": { "size": 1, "sort": [{ "time_stamp": { "order": "desc" } }] } } }
                }
            }
        },
        json: true
    };

    Request(options, function (error, response, body) {
        if (error) {
            console.error(error);
            return;
        }

        var bike_list = [];
        body.aggregations.get_tags.buckets.forEach(buckets => {

            var bike_id = buckets.desc_top.hits.hits[0]._source.device_id
           
            if (bike_id >= 10000 && bike_id < 50000) { // lora 디바이스는 제외.

                if (map.get(bike_id + "") != null) {

                    var timestamp = buckets.desc_top.hits.hits[0]._source.time_stamp
                    var address = buckets.desc_top.hits.hits[0]._source.full_addr
                    var battery = buckets.desc_top.hits.hits[0]._source.battery

                    var lon_d = parseInt(buckets.desc_top.hits.hits[0]._source.longitude / 100);
                    var lon_m = (buckets.desc_top.hits.hits[0]._source.longitude - (lon_d * 100)) / 60;
                    var lng = lon_d + lon_m;

                    var lat_d = parseInt(buckets.desc_top.hits.hits[0]._source.latitude / 100);
                    var lat_m = (buckets.desc_top.hits.hits[0]._source.latitude - (lat_d * 100)) / 60;
                    var lat = lat_d + lat_m;

                    var type = getType(bike_id)
                    var status = getStatus(timestamp, battery) // 1 : 정상 , 2: 데이터미수신(우선순위 높음) , 3: 배터리부족(우선순위 낮음)

                    var device_type = map.get(bike_id + "")._source.device_type;

                    var current_version = !!map.get(bike_id + "")._source.current_version ? map.get(bike_id + "")._source.current_version : '1.0.0';
                    var update_version = !!map.get(bike_id + "")._source.update_version ? map.get(bike_id + "")._source.update_version : '1.0.0';
                    var update_enable = !!map.get(bike_id + "")._source.update_enable ? map.get(bike_id + "")._source.update_enable : 'false';
                    //var update_enable = true;
                    bike_list.push({
                        device_id: bike_id,
                        timestamp: moment(timestamp, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss'),
                        address: address,
                        battery: battery,
                        lng: lng,
                        lat: lat,
                        type: type,
                        status: status,
                        device_type: device_type,
                        current_version: current_version,
                        update_version: update_version,
                        update_enable: update_enable
                    })
                }

            }
        });
        //console.log(bike_list);

        res.json(bike_list);
    });


});


function getType(bike_id) {
    if (bike_id >= 10000 && bike_id < 30000) {
        return TYPE_FIXED;
    } else {
        return TYPE_MOVEMENT;
    }
}

function getStatus(timestamp, battery) {
    if (TIME_LIMIT < (new Date().getTime() - moment(timestamp, 'YYYYMMDDHHmmss').toDate().getTime())) {
        return STATUS_BORKEN
    } else if (battery <= BATTERY_LIMIT) {
        return STATUS_BATTERY
    } else {
        return STATUS_NORMAL
    }
    //return getRandomInt();
}

function getRandomInt() {
    var min = 1;
    var max = 3;
    var random = Math.floor(Math.random() * (+max - +min)) + +min;
    return random;
}


router.get('/ssh')



// router.get('/db_info/:id', function (req, res, next) {
//     console.log('test', req.params.id);

//     if (req.params.id == 'mysql') {
//         con.query('SELECT * FROM smartcity.base_bike_info', function (err, rows) {
//             if (err) throw err;
//             res.send(rows);
//         });
//     } else if (req.params.id == 'elastic_search') {

//     }
// })



/* GET users listing. */
// router.get('/:id', function (req, res, next) {
//     res.send('respond with a resource ++ '+ req.params.id);
// });


/* GET users listing. */
// router.get('/list/:id', function (req, res, next) {
//     con.query('SELECT * FROM smartcity.base_bike_info', function (err, rows) {
//         if (err) throw err;
//         res.send(rows);
//     });
// });


// insert
/* router.post('/regist', function (req, res) {
    var user = {
        'userid': req.body.userid,
        'name': req.body.name,
        'address': req.body.address
    };
    var query = connection.query('insert into users set ?', user, function (err, result) {
        if (err) {
            console.error(err);
            throw err;
        }
        res.status(200).send('success');
    });
}); */