var express = require('express');
var mysql = require('mysql');
var router = express.Router();
var Request = require('request-promise');
var moment = require('moment');
var util = require('util');

const elk_url = "192.168.1.130:9200"
const FIXED_DEVICE = 1;
const MOVEMENT_DEVICE = 2;

const TIME_LIMIT = 1000 * 60 * 30;
const BATTERY_LIMIT = 20;
const STATUS_NORMAL = 1;
const STATUS_BORKEN = 2;
const STATUS_BATTERY = 3;

// Connection 객체 생성 
var con = mysql.createConnection({
    host: '118.131.116.84',
    port: 33306,
    user: 'smartcity',
    password: '*smartcity*',
    database: 'smartcity'
});

module.exports = router;

// Connect
con.connect(function (err) {
    if (err) {
        console.error('mysql connection error');
        console.error(err);
        throw err;
    }
    setInterval(() => {
        updateNetworkResource(con);
    }, 5000)
});

// search from elasticSearch
const MODULE_TYPE_LTE = 1;
const MODULE_TYPE_LORA = 2;
const MODULE_TYPE_NBIOT = 3;

var latest_total_count = 0;
function updateNetworkResource(con) {
    options = {
        method: 'GET',
        url: 'http://' + elk_url + '/v2-logstash-smart-sensor-*/_count',
        headers:
        {
            'cache-control': 'no-cache',
            'Content-Type': 'application/json'
        },
        json: true
    }
    Request(options, function (error, response, body) {
        if (error) throw new Error(error);
        var total_count = body.count;
        
        if (latest_total_count === 0) {
            latest_total_count = total_count;
        } else {
            if ( (total_count - latest_total_count) > 0) {
                var query = util.format(" INSERT INTO 5g_dashboard_module_traffic(time_stamp,module_type,add_count,total_count) values (now(),%s,%s,%s)"
                    , MODULE_TYPE_LTE, total_count - latest_total_count, total_count);

                con.query(query, function (err, rows) {
                    if (err) throw err;
                    console.log(rows);
                });
            }
        }
        latest_total_count = total_count;
    });
}


router.get('/module_traffic', async function (req, res, next) {
    var query = "SELECT date_format(time_stamp, '%H:%i') as time_stamp , sum(add_count) as add_count, max(total_count) as total_count  FROM 5g_dashboard_module_traffic group by  date_format(time_stamp, '%H:%i')  order by time_stamp limit 30"
    con.query(query, function (err, rows) {

        if (err) throw err;
        res.json(rows);
    });

});


/* GET users listing. */
router.get('/device_list', async function (req, res, next) {
    var options = null;
    var response = null;

    options = {
        method: 'POST',
        url: "http://" + elk_url + "/v2-smart-city-sensor-list/_search?pretty",
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
            map.set(item._id, item._id);
        });
    } catch (e) {

    }

    options = {
        method: 'POST',
        url: 'http://' + elk_url + '/v2-logstash-smart-sensor-*/_search?pretty',
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
        if (error) throw new Error(error);
        var bike_list = [];
        body.aggregations.get_tags.buckets.forEach(buckets => {

            var bike_id = buckets.desc_top.hits.hits[0]._source.device_id

            if (bike_id >= 10000 && bike_id < 50000) {

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
                    bike_list.push({
                        device_id: bike_id,
                        timestamp: moment(timestamp, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss'),
                        address: address,
                        battery: battery,
                        lng: lng,
                        lat: lat,
                        type: type,
                        status: status
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
        return FIXED_DEVICE;
    } else {
        return MOVEMENT_DEVICE;
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



router.get('/db_info/:id', function (req, res, next) {
    console.log('test', req.params.id);

    if (req.params.id == 'mysql') {
        con.query('SELECT * FROM smartcity.base_bike_info', function (err, rows) {
            if (err) throw err;
            res.send(rows);
        });
    } else if (req.params.id == 'elastic_search') {

    }
})



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