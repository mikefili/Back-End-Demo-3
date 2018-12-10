'use strict';

const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const app = express();

const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

app.use(express.static('./'));
app.use(cors());


app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMovies);
app.get('/meetups', getMeetUps);
app.get('/trails', getTrails);


// Object Constructors
// Location
function Location(query, res) {
  this.search_query = query;
  this.formatted_query = res.formatted_address;
  this.latitude = res.geometry.location.lat;
  this.longitude = res.geometry.location.lng;
}

// Weather
function Weather(data) {
  this.forecast = data.summary;
  this.time = new Date(data.time * 1000).toDateString();
  this.table = 'weathers';
  this.created_time = Date.now();
}

// Yelp
function Restaurant(data) {
  this.name = data.name;
  this.image_url = data.image_url;
  this.price = data.price;
  this.rating = data.rating;
  this.url = data.url;
  this.table = 'yelps';
  this.created_time = Date.now();
}

// Movies
function Movie(data) {
  this.title = data.title;
  this.overview = data.overview;
  this.average_votes = data.vote_average;
  this.total_votes = data.vote_count;
  this.image_url = 'https://image.tmdb.org/t/p/w370_and_h556_bestv2/' + data.poster_path;
  this.popularity = data.popularity;
  this.released_on = data.release_data;
  this.table = 'movies';
  this.created_time = Date.now();
}

// Meetups
function MeetUp(data) {
  this.link = data.link;
  this.name = data.name;
  this.creation_date = new Date(data.created * 1000).toDateString();
  this.host = data.organizer.name;
  this.table = 'meetups';
  this.created_time = Date.now();
}

// Trails
function Trail(data) {
  this.name = data.name;
  this.location = data.location;
  this.length = data.length;
  this.stars = data.stars;
  this.star_votes = data.starVotes;
  this.summary = data.summary;
  this.trail_url = data.url;
  this.conditions = data.conditionStatus;
  this.condition_date = data.conditionDate;
  this.condition_time = new Date(data.conditionDate).toDateString();
  this.table = 'trails';
  this.created_time = Date.now();
}

// Location Logic
function getLocation(req, res) {
  const locationHandler = {
    location: req.query.data,
    cacheHit: (results) => {
      console.log('Got data from SQL', results);
      res.send(results.rows[0]);
    },
    cacheMiss: () => {
      Location.fetchLocation(req.query.data)
        .then(data => res.send(data))
        .catch(error => errorHandler(error));
    }
  };
  Location.dbLocationLookup(locationHandler);
}

Location.dbLocationLookup = element => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [element.query];
  return client.query(SQL, values)
    .then(results => {
      if (results.rowCount > 0) {
        element.cacheHit(results);
      }
      else {
        element.cacheMiss();
      }
    })
    .catch(error => errorHandler(error));
};

Location.fetchLocation = query => {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;
  return superagent.get(url)
    .then(data => {
      console.log('Got data from API');
      if (!data.body.results.length) {
        throw 'No Data';
      } else {
        let geoLocation = new Location(query, data.body.results[0]);
        return geoLocation.save()
          .then(result => {
            geoLocation.id = result.rows[0].id;
            return geoLocation;
          });
      }
    });
};

Location.prototype.save = function () {
  let SQL = `INSERT INTO locations (search_query,formatted_query,latitude,longitude) VALUES($1,$2,$3,$4) RETURNING id;`;
  let values = Object.values(this);
  return client.query(SQL, values);
};

// Clean up DB
Weather.clearDB = clearDB;
Restaurant.clearDB = clearDB;
Movie.clearDB = clearDB;
MeetUp.clearDB = clearDB;
Trail.clearDB = clearDB;

// Weather Logic
function getWeather(req, res) {
  const weatherHandler = {
    location: req.query.data,
    cacheHit: function (result) {
      let dataAgeInMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (dataAgeInMins > 30) {
        Weather.clearDB(Weather.table, req.query.data.id);
        console.log('delete SQL');
        Weather.fetchWeather(req.query.data)
          .then(results => res.send(results))
          .catch(error => errorHandler(error));
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function () {
      Weather.fetchWeather(req.query.data)
        .then(results => res.send(results))
        .catch(error => errorHandler(error));
    },
  };
  Weather.weatherLookup(weatherHandler);
}

Weather.weatherLookup = function (handler) {
  const SQL = `SELECT * FROM weathers WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => errorHandler(error));
};

Weather.fetchWeather = function (location) {
  const weathers = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;
  return superagent.get(weathers)
    .then(result => {
      const weatherSummary = result.body.daily.data.map(day => {
        const wSummary = new Weather(day);
        wSummary.save(location.id);
        return wSummary;
      });
      return weatherSummary;
    });
};

Weather.prototype.save = function (id) {
  const SQL = `INSERT INTO weathers (forecast, time,created_time,location_id) VALUES ($1,$2,$3,$4);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Yelp Logic
function getYelp(req, res) {
  const yelpHandler = {
    location: req.query.data,
    cacheHit: function (result) {
      let dataAgeInMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (dataAgeInMins > 10080) {
        Restaurant.clearDB(Restaurant.table, req.query.data.id);
        console.log('delete SQL');
        Restaurant.fetchYelp(req.query.data)
          .then(results => res.send(results))
          .catch(error => errorHandler(error));
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function () {
      Restaurant.fetchYelp(req.query.data)
        .then(results => res.send(results))
        .catch(error => errorHandler(error));
    }
  };
  Restaurant.yelpLookup(yelpHandler);
}

Restaurant.yelpLookup = function (handler) {
  const SQL = `SELECT * FROM yelps WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => errorHandler(error));
};

Restaurant.fetchYelp = function (location) {
  const url = (`https://api.yelp.com/v3/businesses/search?location=${location.search_query}/${location.latitude},${location.longitude}`);
  return superagent.get(url)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(result => {
      const yelps = result.body.businesses.map(rest => {
        const summary = new Restaurant(rest);
        summary.save(location.id);
        return summary;
      });
      return yelps;
    });
};

Restaurant.prototype.save = function (id) {
  const SQL = `INSERT INTO yelps (name,image_url,price,rating,url,created_time,location_id) VALUES ($1,$2,$3,$4,$5,$6,$7);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Movie Logic
function getMovies(req, res) {
  const movieHandler = {
    location: req.query.data,
    cacheHit: function (result) {
      let dataAgeInMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (dataAgeInMins > 1440) {
        Movie.clearDB(Movie.table, req.query.data.id);
        console.log('delete SQL');
        Movie.fetchMovies(req.query.data)
          .then(results => res.send(results))
          .catch(error => errorHandler(error));
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function () {
      Movie.fetchMovies(req.query.data)
        .then(results => res.send(results))
        .catch(error => errorHandler(error));
    }
  };
  Movie.movieLookup(movieHandler);
}

Movie.movieLookup = function (handler) {
  const SQL = `SELECT * FROM movies WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cachehit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => errorHandler(error));
};

Movie.fetchMovies = function (location) {
  const tmdbData = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIEDB_API_KEY}&query=${location.search_query}`;
  return superagent.get(tmdbData)
    .then(result => {
      const movies = result.body.results.map(rest => {
        const movieSummary = new Movie(rest);
        movieSummary.save(location.id);
        return movieSummary;
      });
      return movies;
    });
};

Movie.prototype.save = function (id) {
  const SQL = `INSERT INTO movies (title,overview,average_votes,total_votes,image_url,popularity,release_on,created_time,location_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Meet Ups Logic
function getMeetUps(req, res) {
  const meetupHandler = {
    location: req.query.data,
    cacheHit: function (result) {
      let dataAgeInMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (dataAgeInMins > 1440) {
        MeetUp.clearDB(MeetUp.table, req.query.data.id);
        console.log('delete SQL');
        MeetUp.fetchMeetUps(req.query.data)
          .then(results => res.send(results))
          .catch(error => errorHandler(error));
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function () {
      MeetUp.fetchMeetUps(req.query.data)
        .then(results => res.send(results))
        .catch(error => errorHandler(error));
    }
  };
  MeetUp.lookupMeetUps(meetupHandler);
}

MeetUp.lookupMeetUps = function (handler) {
  const SQL = `SELECT * FROM meetups WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => errorHandler(error));
};

MeetUp.fetchMeetUps = function (location) {
  const url = (`https://api.meetup.com/find/groups?sign=true&photo-host=public&location=${location.search_query}&page=20&key=${process.env.MEETUP_API_KEY}`);
  return superagent.get(url)
    .then(result => {
      const meetups = result.body.map(rest => {
        const summary = new MeetUps(rest);
        summary.save(location.id);
        return summary;
      });
      return meetups;
    });
};

MeetUp.prototype.save = function (id) {
  const SQL = `INSERT INTO meetups (link,name,creation_date,host,created_time,location_id) VALUES ($1,$2,$3,$4,$5,$6);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Trails Logic
function getTrails(req, res) {
  const trailHandler = {
    location: req.query.data,
    cacheHit: function (result) {
      let dataAgeInMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (dataAgeInMins > 40320) {
        Trail.clearDB(Trail.table, req.query.data.id);
        console.log('delete SQL');
        Trail.fetchTrails(req.query.data)
          .then(results => res.send(results))
          .catch(error => errorHandler(error));
      } else {
        res.send(result.rows);
      }
    },
    cacheMiss: function () {
      Trail.fetchTrails(req.query.data)
        .then(results => res.send(results))
        .catch(error => errorHandler(error));
    }
  };
  Trail.trailsLookup(trailHandler);
}

Trail.trailsLookup = function (handler) {
  const SQL = `SELECT * FROM trails WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.result > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => errorHandler(error));
};

Trail.fetchTrails = function (location) {
  const url = `https://www.hikingproject.com/data/get-trails?key=${process.env.TRAILS_API_KEY}&lat=${location.latitude}&lon=${location.longitude}&maxDistance=10`;
  return superagent.get(url)
    .then(result => {
      const trailData = result.body.trails.map(rest => {
        const summary = new Trail(rest);
        summary.save(location.id);
        return summary;
      });
      return trailData;
    });
};

Trail.prototype.save = function (id) {
  const SQL = `INSERT INTO trails (name,location,length,stars,star_votes,summary,trail_url,conditions,condition_date,condition_time,created_time,location_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Clear DB Logic
function clearDB(table, city) {
  const clearTableData = `DELETE from ${table} WHERE location_id=${city};`;
  return client.query(clearTableData);
}

// Error Handler
function errorHandler(err, res) {
  console.log(err);
  if (res) res.status(500).send('ERROR. Please try again.');
}

// Port Confirmation
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});