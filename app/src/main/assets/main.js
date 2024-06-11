class Cache {
  constructor (ttl, prefix) {
    this.prefix = prefix || 'asafonov.org'
    this.ttl = ttl || 3600000
  }
  set (name, value) {
    const ts = new Date().getTime()
    localStorage.setItem(this.prefix + name, JSON.stringify({ts, value}))
    return value
  }
  get (name) {
    const data = JSON.parse(localStorage.getItem(this.prefix + name))
    if (data && data.ts) {
      if (data.ts + this.ttl > new Date().getTime())
        return data.value
    }
    return
  }
  getItem (name) {
    const data = JSON.parse(localStorage.getItem(this.prefix + name))
    return data ? data.value : null
  }
  remove (name) {
    localStorage.removeItem(this.prefix + name)
  }
  destroy() {
    this.ttl = null
    this.prefix = null
  }
}
class Forecast {
  constructor (place) {
    const capitalize = v => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
    this.place = place.split(' ').map(i => capitalize(i)).join(' ')
  }
  getPlace() {
    return this.place
  }
  formatData (item) {
    return {
      temp: item.temp,
      time: item.date.substr(11),
      hour: item.date.substr(11, 2),
      day: item.date.substr(8, 2),
      wind_speed: item.wind_speed,
      wind_direction: item.wind_direction,
      pressure: item.pressure,
      humidity: item.humidity,
      clouds: item.clouds,
      rain: item.rain,
      snow: item.snow
    }
  }
  getCachedData() {
    return asafonov.cache.getItem(this.place)
  }
  async getData() {
    let data = asafonov.cache.get(this.place)
    if (! data) {
      data = {hourly: [], daily: []}
      const url = `${asafonov.settings.apiUrl}/?place=${this.place}`
      try {
        const apiResp = await (await fetch(url)).json()
        const date = apiResp[0].date.substr(0, 10)
        let maxToday = apiResp[0].temp
        let minToday = apiResp[0].temp
        let prevDate = date
        for (let i = 1; i < apiResp.length; ++i) {
          let d = apiResp[i].date.substr(0, 10)
          let h = apiResp[i].date.substr(11, 2)
          if (d !== prevDate) {
            if (data.daily.length > 0) {
              const index = data.daily.length - 1
              if (data.daily[index].rain < 0.5) data.daily[index].rain = 0
              if (data.daily[index].snow < 0.5) data.daily[index].snow = 0
            }
            data.daily.push({rain: 0, snow: 0, clouds: 0, wind_speed: 0, day: apiResp[i].day})
            prevDate = d
          }
          if (d === date) {
            maxToday = Math.max(apiResp[i].temp, maxToday)
            minToday = Math.min(apiResp[i].temp, minToday)
          } else {
            const index = data.daily.length - 1
            data.daily[index].rain = Math.max(apiResp[i].rain || 0, data.daily[index].rain)
            data.daily[index].snow = Math.max(apiResp[i].snow || 0, data.daily[index].snow)
            data.daily[index].wind_speed = Math.max(apiResp[i].wind_speed || 0, data.daily[index].wind_speed)
            data.daily[index].clouds += (apiResp[i].clouds || 0) / 8
            if (h >= '00' && h <= '08') {
              data.daily[index].morning = data.daily[index].morning !== undefined ? Math.min(data.daily[index].morning, apiResp[i].temp) : apiResp[i].temp
            }
            if (h > '08' && h <= '20') {
              data.daily[index].temp = data.daily[index].temp !== undefined ? Math.max(data.daily[index].temp, apiResp[i].temp) : apiResp[i].temp
              data.daily[index].wind_direction = apiResp[i].wind_direction
            }
            if (h > '20') {
              data.daily[index].evening = data.daily[index].evening !== undefined ? Math.min(data.daily[index].evening, apiResp[i].temp) : apiResp[i].temp
            }
          }
          if (i <= 16) {
            data.hourly.push(this.formatData(apiResp[i]))
          }
        }
        data.now = {
          ...this.formatData(apiResp[0]), ...{max: maxToday, min: minToday, timezone: apiResp[0].timezone}
        }
        asafonov.cache.set(this.getPlace(), data)
      } catch (e) {
        console.error(e)
        return
      }
    }
    return data
  }
  destroy() {
    this.place = null
  }
}
class MessageBus {
  constructor() {
    this.subscribers = {};
  }
  send (type, data) {
    if (this.subscribers[type] !== null && this.subscribers[type] !== undefined) {
      for (var i = 0; i < this.subscribers[type].length; ++i) {
        this.subscribers[type][i]['object'][this.subscribers[type][i]['func']](data);
      }
    }
  }
  subscribe (type, object, func) {
    if (this.subscribers[type] === null || this.subscribers[type] === undefined) {
      this.subscribers[type] = [];
    }
    this.subscribers[type].push({
      object: object,
      func: func
    });
  }
  unsubscribe (type, object, func) {
    if (this.subscribers[type] === null || this.subscribers[type] === undefined) return
    for (var i = 0; i < this.subscribers[type].length; ++i) {
      if (this.subscribers[type][i].object === object && this.subscribers[type][i].func === func) {
        this.subscribers[type].slice(i, 1);
        break;
      }
    }
  }
  unsubsribeType (type) {
    delete this.subscribers[type];
  }
  destroy() {
    for (type in this.subscribers) {
      this.unsubsribeType(type);
    }
    this.subscribers = null;
  }
}
class ControlView {
  constructor() {
    this.addEventListeners()
    this.navigationView = new NavigationView()
    this.forecastViews = []
    const cities = asafonov.cache.getItem('cities')
    if (cities && cities.length > 0) {
      for (let i = 0; i < cities.length; ++i) {
        this.forecastViews.push(new ForecastView(cities[i]))
      }
      this.displayForecast()
    } else {
      const forecastView = new ForecastView(asafonov.settings.defaultCity)
      forecastView.display()
    }
  }
  displayForecast (index) {
    if (index === null || index === undefined) {
      index = asafonov.cache.getItem('city')
      if (index === null || index ===undefined || index > this.forecastViews.length - 1) index = this.forecastViews.length - 1
    }
    asafonov.cache.set('city', index)
    this.forecastViews[index].display()
  }
  addEventListeners() {
    asafonov.messageBus.subscribe(asafonov.events.CITY_ADDED, this, 'onCityAdded')
    asafonov.messageBus.subscribe(asafonov.events.CITY_SELECTED, this, 'onCitySelected')
  }
  removeEventListeners() {
    asafonov.messageBus.unsubscribe(asafonov.events.CITY_ADDED, this, 'onCityAdded')
    asafonov.messageBus.unsubscribe(asafonov.events.CITY_SELECTED, this, 'onCitySelected')
  }
  onCityAdded ({city}) {
    this.forecastViews.push(new ForecastView(city))
    this.displayForecast(this.forecastViews.length - 1)
  }
  onCitySelected ({index}) {
    this.displayForecast(index)
  }
  destroy() {
    for (let i = 0; i < this.forecastViews.length; ++i) {
      this.forecastViews[i].destroy()
      this.forecastViews[i] = null
    }
    this.forecastViews = null
    this.navigationView.destroy()
    this.navigationView = null
    this.removeEventListeners()
  }
}
class ForecastView {
  constructor (place) {
    this.model = new Forecast(place)
  }
  getIconByData (data) {
    const icons = []
    icons.push(data.clouds > 75 || data.rain || data.snow ? 'cloud' : data.hour >= '20' || data.hour < '08' ? 'moon' : 'sun')
    if (! data.rain && ! data.snow && data.clouds >= 25 && data.clouds <= 75) icons.push('cloud')
    if (data.rain) icons.push('rain')
    if (data.rain > 1) icons.push('rain')
    if (data.wind_speed > 8) icons.push('wind')
    if (icons.length > 1 && icons[0] === 'cloud') icons[0] = 'cloud_with'
    return icons
  }
  getIcon (icons) {
    let ret = `<svg ${icons.length > 1 ? 'class="icon_with"' : ''}><use xlink:href="#${icons[0]}" /></svg>`
    if (icons.length > 1) ret += `<svg class="icon_dop"><use xlink:href="#${icons[1]}" /></svg>`
    if (icons.length > 2) ret += `<svg class="icon_dop dop_second dop_duo"><use xlink:href="#${icons[2]}" /></svg>`
    return ret
  }
  getDayName (day) {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    return dayNames[day - 1]
  }
  async display() {
    document.querySelector('.city_name').innerHTML = this.model.getPlace()
    this.displayData(this.model.getCachedData())
    const data = await this.model.getData()
    this.displayData(data)
  }
  getCurrentTime (timezone) {
    return new Date(new Date().getTime() + (timezone || 0) * 1000).toISOString().substr(11, 5)
  }
  displayData (data) {
    if (! data) return
    document.querySelector('.temperature .now').innerHTML = `${data.now.temp}°`
    document.querySelector('.temperature .max').innerHTML = `${data.now.max}°`
    document.querySelector('.temperature .min').innerHTML = `${data.now.min}°`
    document.querySelector('.city_time').innerHTML = this.getCurrentTime(data.now.timezone)
    const icons = this.getIconByData(data.now)
    const iconDiv = document.querySelector('.icon_weather')
    iconDiv.innerHTML = this.getIcon(icons)
    iconDiv.classList[data.now.rain ? 'remove' : 'add']('icon_dop_top')
    const hourlyDiv = document.querySelector('.scroll_line')
    hourlyDiv.innerHTML = ''
    for (let i = 0; i < data.hourly.length; ++i) {
      hourlyDiv.innerHTML +=
        `<div class="item_scroll_line flex_col centered">
          <div class="text_accent">${data.hourly[i].hour}</div>
          <div class="icon icon_weather icon_normal${data.hourly[i].rain ? '' : ' icon_dop_top'}">
            ${this.getIcon(this.getIconByData(data.hourly[i]))}
          </div>
          <div class="text_h3">${data.hourly[i].temp}°</div>
        </div>`
    }
    const dailyDiv = document.querySelector('.days_list')
    dailyDiv.innerHTML = ''
    for (let i = 0; i < data.daily.length; ++i) {
      if (! data.daily[i].evening) break
      dailyDiv.innerHTML +=
        `<div class="item_days_list flex_row centered">
          <div class="day_name">${i === 0 ? 'Tomorrow' : this.getDayName(data.daily[i].day)}</div>
          <div class="right_part flex_row centered">
            <div class="icon icon_weather icon_normal${data.daily[i].rain ? '' : ' icon_dop_top'}">
              ${this.getIcon(this.getIconByData(data.daily[i]))}
            </div>
            <div class="temperature flex_row">
              <div class="text_accent">${data.daily[i].morning}°</div>
              <div class="icon icon_small">
                <svg>
                  <use xlink:href="#sun_up"/>
                </svg>
              </div>
              <div class="text_h3">${data.daily[i].temp}°</div>
              <div class="icon icon_small">
                <svg>
                  <use xlink:href="#sun_down"/>
                </svg>
              </div>
              <div class="text_accent">${data.daily[i].evening}°</div>
            </div>
            <div class="wind flex_row centered">
              <div class="power">${data.daily[i].wind_speed}</div>
              <div class="direction flex_col centered">
                <div class="icon icon_fill icon_compas compas_se">
                  <svg>
                    <use xlink:href="#direction"/>
                  </svg>
                </div>
                <div class="text_small_dop">${data.daily[i].wind_direction}</div>
              </div>
            </div>
          </div>
        </div>`
    }
  }
  destroy() {
    this.model.destroy()
    this.model = null
  }
}
class NavigationView {
 
  constructor() {
    const navigationContainer = document.querySelector('.navigation')
    this.addButton = navigationContainer.querySelector('.icon_add')
    this.pagesButtons = navigationContainer.querySelector('.pages')
    this.onAddClickProxy = this.onAddClick.bind(this)
    this.addEventListeners()
    this.updatePagesButtons()
  }
  updatePagesButtons (selected) {
    const cities = asafonov.cache.getItem('cities')
    const city = selected || asafonov.cache.getItem('city')
    if (cities && cities.length > 1) {
      this.pagesButtons.style.opacity = 1
      this.pagesButtons.innerHTML = ''
      for (let i = 0; i < cities.length; ++i) {
        const div = document.createElement('div')
        div.className = 'icon icon_small'
        if (i === city) div.id = 'selected_page'
        div.innerHTML = '<svg><use xlink:href="#pages"/></svg>'
        div.addEventListener('click', () => this.selectCity(i))
        this.pagesButtons.appendChild(div)
      }
    } else {
      this.pagesButtons.style.opacity = 0
    }
  }
  selectCity (index) {
    asafonov.messageBus.send(asafonov.events.CITY_SELECTED, {index})
    const pages = this.pagesButtons.querySelectorAll('.icon')
    for (let i = 0; i < pages.length; ++i) {
      if (i === index) {
        pages[i].id = 'selected_page'
      } else {
        pages[i].removeAttribute('id')
      }
    }
  }
  async onAddClick() {
    let city = prompt('Please enter the city in English')
    if (city) {
      city = city.toLowerCase()
      const model = new Forecast(city)
      const data = await model.getData()
      if (data) {
        const cities = asafonov.cache.getItem('cities') || []
        if (cities.indexOf(city) === -1) {
          cities.push(city)
          asafonov.messageBus.send(asafonov.events.CITY_ADDED, {city})
          asafonov.cache.set('cities', cities)
          this.updatePagesButtons()
        }
      }
      model.destroy()
    }
  }
  addEventListeners() {
    this.addButton.addEventListener('click', this.onAddClickProxy)
  }
  removeEventListeners() {
    this.addButton.removeEventListener('click', this.onAddClickProxy)
  }
  destroy() {
    this.removeEventListeners()
    this.addButton = null
    this.pagesButtons.innerHTML = ''
    this.pagesButtons = null
  }
}
window.asafonov = {}
window.asafonov.version = '0.1'
window.asafonov.messageBus = new MessageBus()
window.asafonov.cache = new Cache(600000)
window.asafonov.events = {
  CITY_ADDED: 'CITY_ADDED',
  CITY_SELECTED: 'CITY_SELECTED'
}
window.asafonov.settings = {
  apiUrl: 'http://isengard.asafonov.org/weather/',
  defaultCity: 'Belgrade'
}
window.onerror = (msg, url, line) => {
  if (!! window.asafonov.debug) alert(`${msg} on line ${line}`)
}
document.addEventListener("DOMContentLoaded", function (event) {
  const view = new ControlView()
})
