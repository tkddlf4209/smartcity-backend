var express = require('express');
var mysql = require('mysql');
var router = express.Router();
var Request = require('request');
let moment = require('moment');

// Connection 객체 생성 
var con = mysql.createConnection({
    host: '118.131.116.84',
    port: 33306,
    user: 'smartcity',
    password: '*smartcity*',
    database: 'smartcity'
});
// Connect
con.connect(function (err) {
    if (err) {
        console.error('mysql connection error');
        console.error(err);
        throw err;
    }
});

var elk_url = "192.168.1.130:9200"
/* GET users listing. */
router.get('/device_list', function (req, res, next) {

    var buckets;
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

            if(bike_id >=10000 && bike_id<50000){

                var timestamp = buckets.desc_top.hits.hits[0]._source.time_stamp
                var address =buckets.desc_top.hits.hits[0]._source.full_addr
                var battery = buckets.desc_top.hits.hits[0]._source.battery
                
                var lon_d = parseInt(buckets.desc_top.hits.hits[0]._source.longitude / 100);
                var lon_m = (buckets.desc_top.hits.hits[0]._source.longitude - (lon_d * 100)) / 60;
                var lng = lon_d + lon_m;
    
                var lat_d = parseInt(buckets.desc_top.hits.hits[0]._source.latitude / 100);
                var lat_m = (buckets.desc_top.hits.hits[0]._source.latitude - (lat_d * 100)) / 60;
                var lat = lat_d + lat_m;


                var type = getType(bike_id)
                var status = getStatus(timestamp,battery) // 1 : 정상 , 2: 데이터미수신(우선순위 높음) , 3: 배터리부족(우선순위 낮음)
                bike_list.push({
                    bike_id:bike_id,
                    timestamp:timestamp,
                    address:address,
                    battery:battery,
                    lng:lng,
                    lat:lat,
                    type:type,
                    status:status
                })
    
            }
        });
        //console.log(bike_list);
        
        res.json(bike_list);
    });

});

const FIXED_DEVICE = 1;
const MOVEMENT_DEVICE = 2;
function getType(bike_id){
    if(bike_id >=10000 && bike_id<30000){
        return FIXED_DEVICE;
    }else{
        return MOVEMENT_DEVICE;
    }
}

const TIME_LIMIT = 1000 * 60 * 15;
const BATTERY_LIMIT = 20;
const STATUS_NORMAL = 1;
const STATUS_BORKEN = 2;
const STATUS_BATTERY = 3;

function getStatus(timestamp,battery){

    if (  TIME_LIMIT < (new Date().getTime() -  moment(timestamp,'YYYYMMDDHHmmss').toDate().getTime())){
        return STATUS_BORKEN
    } else if(battery <= BATTERY_LIMIT){
        return STATUS_BATTERY
    } else{
        return STATUS_NORMAL
    }
    //return getRandomInt();
}

function getRandomInt() {
    var min=1; 
    var max=3;  
    var random =  Math.floor(Math.random() * (+max - +min)) + +min; 
    return random;
}



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

module.exports = router;
